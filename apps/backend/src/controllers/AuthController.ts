import {
  NextFunction,
  Request as ExRequest,
  Response as ExResponse,
} from 'express';
import { JwtPayload, TokenExpiredError } from 'jsonwebtoken';
import {
  Controller,
  Middlewares,
  Patch,
  Path,
  Post,
  Request,
  Res,
  Response,
  Route,
  Security,
  SuccessResponse,
  Tags,
  TsoaResponse,
} from 'tsoa';
import {
  Body,
  ValidateBody,
  zodIssuesToDetails,
} from '../decorators/request-body-validator';
import apiTokens from '../helpers/ApiTokens';
import { ACCESS_TOKEN_EXPIRES_IN_MS } from '../helpers/tokenLifetimes';
import {
  REFRESH_COOKIE_NAME,
  clearRefreshCookieIfPresent,
  setRefreshCookieIfPresent,
} from '../helpers/cookieHelper';
import { isEmailVerified } from '../helpers/isEmailVerified';
import filterUser from '../helpers/filterUser';
import PlatformTokenHandler from '../helpers/PlatformTokenHandler';
import { decodeToken } from '../helpers/jwtHelper';
import { isTokenIssuedBeforeInvalidation } from '../helpers/sessionInvalidation';
import { ValidateErrorJSON } from '../interfaces';
import isOwner from '../middleware/isOwner';
import { RegisterUserResponse, RefreshTokenBody } from '../models/Auth';
import {
  ConfirmResetPasswordBody,
  ResetPasswordByEmailBody,
  UserCreationBody,
  UserLoginBody,
} from '../models/User';
import {
  LoginSchema,
  refreshTokenSchema,
  resendVerificationSchema,
  resetPasswordSchema,
  updatePasswordSchema,
  VerifyEmailSchema,
} from '../schemas/auth.schema';
import { UserSchema } from '../schemas/user.schema';
import userService from '../services/UserService';
import {
  FilteredUserInterface,
  UserInterface,
  VersionFloorRefusal,
} from '../types';
import passport from '../utils/passport';

function validateLoginBody(
  req: ExRequest,
  res: ExResponse,
  next: NextFunction,
): void {
  const check = LoginSchema.safeParse(req.body);
  if (!check.success) {
    res.status(422).json({
      message: 'Validation Failed',
      details: zodIssuesToDetails(check.error),
    });
    return;
  }
  next();
}

function authenticateLocal(
  req: ExRequest,
  res: ExResponse,
  next: NextFunction,
): void {
  passport.authenticate(
    'local',
    { session: false, failureMessage: false },
    (err: unknown, user: unknown, info?: { message?: string }) => {
      if (err) {
        next(err);
        return;
      }

      if (!user) {
        res.status(401).json({ message: info?.message ?? 'Unauthorized' });
        return;
      }

      req.user = user;
      next();
    },
  )(req, res, next);
}

@Tags('Authentication')
@Route('/auth')
@Response<VersionFloorRefusal>(426, 'Below the Version Floor')
export class AuthController extends Controller {
  @Post('/login')
  @Response(200, 'Success')
  @Response(401, 'Unauthorized')
  @Response(403, 'Email not verified')
  @Response<ValidateErrorJSON>(422, 'Validation Failed')
  @Middlewares([validateLoginBody, authenticateLocal])
  async login(
    @Request() req: ExRequest,
    @Body() requestBody: UserLoginBody,
    @Res() unauthorized: TsoaResponse<401, { message: string }>,
    @Res() forbidden: TsoaResponse<403, { message: string }>,
  ): Promise<{
    token: string;
    expires_in: number;
    user: FilteredUserInterface;
    refresh_token?: string;
  }> {
    const requestUser = req.user as UserInterface;

    if (requestUser?.disabled) {
      return unauthorized(401, { message: 'Account disabled' });
    }

    if (!isEmailVerified(requestUser)) {
      return forbidden(403, {
        message: 'Email not verified. Please verify your email first.',
      });
    }

    try {
      const { body, refreshToken } = PlatformTokenHandler.issueLoginSession(
        requestUser,
        requestBody.client_type,
      );
      setRefreshCookieIfPresent(req, refreshToken);
      this.setStatus(200);
      return body;
    } catch {
      this.setStatus(500);
      throw new Error('Failed to create auth tokens');
    }
  }

  @Post('/logout/{userId}')
  @SuccessResponse(200, 'Logged out successfully')
  @Response(401, 'Unauthorized')
  @Response(403, 'Forbidden')
  @Response(500, 'Failed to logout')
  @Middlewares([isOwner])
  @Security('jwt')
  @ValidateBody(refreshTokenSchema)
  async logout(
    @Request() req: ExRequest,
    @Path() userId: string,
    @Body() requestBody?: RefreshTokenBody,
  ): Promise<{ message: string }> {
    const user = req.user as UserInterface;
    const refreshToken =
      requestBody?.refresh_token ??
      (req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined);

    if (!user || !refreshToken) {
      this.setStatus(401);
      return { message: 'Unauthorized' };
    }

    const decoded = decodeToken(
      refreshToken,
      process.env.REFRESH_JWT_SECRET as string,
    );
    if (
      decoded instanceof Error ||
      typeof decoded === 'string' ||
      (decoded as JwtPayload).userId !== user.id
    ) {
      this.setStatus(401);
      return { message: 'Unauthorized' };
    }

    const result = await userService.logout(user.id, refreshToken);
    if (result instanceof Error) {
      this.setStatus(500);
      return { message: 'Failed to logout' };
    }

    void userId;
    clearRefreshCookieIfPresent(req);
    this.setStatus(200);
    return { message: 'Logged out successfully' };
  }

  @Post('/refresh')
  @Response(401, 'Unauthorized')
  @Response(403, 'Email not verified')
  @Response<ValidateErrorJSON>(422, 'Validation Failed')
  @ValidateBody(refreshTokenSchema)
  async refreshToken(
    @Request() req: ExRequest,
    @Res() unauthorized: TsoaResponse<401, { message: string }>,
    @Res() forbidden: TsoaResponse<403, { message: string }>,
    @Body() requestBody?: RefreshTokenBody,
  ): Promise<{
    token: string;
    expires_in: number;
    user: FilteredUserInterface;
  }> {
    const refresh_token =
      requestBody?.refresh_token ??
      (req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined);
    if (!refresh_token) {
      return unauthorized(401, { message: 'Unauthorized' });
    }

    const user = await userService.refreshToken(refresh_token);
    if (user instanceof Error || !user) {
      return unauthorized(401, { message: 'Invalid or expired refresh token' });
    }

    if ((user as { disabled?: boolean }).disabled) {
      clearRefreshCookieIfPresent(req);
      return unauthorized(401, { message: 'Account disabled' });
    }

    if (!isEmailVerified(user)) {
      clearRefreshCookieIfPresent(req);
      return forbidden(403, {
        message: 'Email not verified. Please verify your email first.',
      });
    }

    const refreshPayload = decodeToken(
      refresh_token,
      process.env.REFRESH_JWT_SECRET as string,
    );
    if (
      refreshPayload &&
      !(refreshPayload instanceof Error) &&
      typeof refreshPayload === 'object' &&
      isTokenIssuedBeforeInvalidation(
        (refreshPayload as { iat?: number }).iat,
        (user as { sessions_invalidated_at?: Date | null })
          .sessions_invalidated_at,
      )
    ) {
      clearRefreshCookieIfPresent(req);
      return unauthorized(401, { message: 'Session invalidated' });
    }

    if (user.blacklisted_tokens?.includes(refresh_token)) {
      return unauthorized(401, { message: 'Unauthorized' });
    }

    const { token, refreshToken: newRefreshToken } = apiTokens.createTokens(
      user as UserInterface,
    );
    if (token instanceof Error || newRefreshToken instanceof Error) {
      this.setStatus(500);
      throw new Error('Failed to create auth tokens');
    }
    await userService.recordActivity(user);
    const filteredUser = filterUser(user as UserInterface);

    setRefreshCookieIfPresent(req, newRefreshToken);

    this.setStatus(200);
    return {
      token,
      expires_in: ACCESS_TOKEN_EXPIRES_IN_MS,
      user: filteredUser,
    };
  }

  @Post('/register')
  @Response<ValidateErrorJSON>(422, 'Validation Failed') // Custom error response
  @SuccessResponse(201, 'Created')
  @ValidateBody(UserSchema)
  async registerUser(
    @Body() requestBody: UserCreationBody,
  ): Promise<RegisterUserResponse> {
    const existing = await userService.getByEmail(requestBody.email);
    if (existing) {
      if (isEmailVerified(existing)) {
        this.setStatus(409);
        return { message: 'Email already registered. Please log in.' };
      }

      const token = await userService.sendVerificationMail(existing);
      if (token instanceof Error) {
        if (token.message.includes('already sent recently')) {
          this.setStatus(429);
          return {
            message:
              'A verification email was already sent recently. Please check your inbox and try again later.',
            user: filterUser(existing as UserInterface),
          };
        }

        this.setStatus(500);
        return { message: 'Failed to send verification email.' };
      }

      await userService.update(existing.id, {
        email_verification_token: token,
      });

      this.setStatus(409);
      return {
        message:
          "Email already registered but isn't verified yet. We've resent the verification email.",
        user: filterUser(existing as UserInterface),
      };
    }

    const user = await userService.create(requestBody);
    const token = await userService.sendVerificationMail(user);
    if (token instanceof Error) {
      try {
        await userService.deleteById(user.id);
      } catch {
        // best-effort rollback
      }
      this.setStatus(500);
      return {
        message:
          'Account was not created because we could not send a verification email. Please try again.',
      };
    }

    await userService.update(user.id, {
      email_verification_token: token,
    });

    this.setStatus(201);
    return {
      message: 'Account created. Verification email sent.',
      user: filterUser(user as UserInterface),
    };
  }

  @Patch('/verify/email')
  @Response<ValidateErrorJSON>(422, 'Validation Failed')
  @Response(200, 'Success')
  @ValidateBody(VerifyEmailSchema)
  async verifyEmail(
    @Body() requestBody: { token: string },
  ): Promise<{ message: string }> {
    const decodedToken = decodeToken(
      requestBody.token,
      process.env.VERIFY_JWT_SECRET as string,
    ) as JwtPayload;

    const userId = decodedToken.userId;

    const updateUser = await userService.update(userId, {
      email_verification_timestamp: new Date(),
      email_verification_token: null,
    });

    if (!updateUser) {
      this.setStatus(400);
      return { message: 'Failed to verify email' };
    }

    this.setStatus(200);
    return { message: 'Email verified successfully' };
  }

  @Post('/verify/resend')
  @ValidateBody(resendVerificationSchema)
  async resendVerificationEmailByEmail(
    @Body() requestBody: { email: string },
  ): Promise<{ message: string }> {
    const user = await userService.getByEmail(requestBody.email);
    if (!user) {
      this.setStatus(404);
      return { message: 'User not found' };
    }

    if (isEmailVerified(user)) {
      this.setStatus(409);
      return { message: 'Email already verified. Please log in.' };
    }

    return this.sendVerificationEmailFor(
      user as UserInterface,
      'Failed to send verification email.',
    );
  }

  @Post('/verify/resend/{userId}')
  @Middlewares([isOwner])
  @Security('jwt')
  async resendVerificationEmail(
    @Request() req: ExRequest,
    @Path() userId: string,
  ): Promise<{ message: string }> {
    const user = req.user as UserInterface;
    void userId;

    if (!user) {
      this.setStatus(404);
      return { message: 'User not found' };
    }

    return this.sendVerificationEmailFor(
      user,
      'Failed to resend verification email.',
    );
  }

  private async sendVerificationEmailFor(
    user: UserInterface,
    failedSendMessage: string,
  ): Promise<{ message: string }> {
    const token = await userService.sendVerificationMail(user);

    if (token instanceof Error) {
      if (token.message.includes('already sent recently')) {
        this.setStatus(429);
        return {
          message:
            'A verification email was already sent recently. Please check your inbox and try again later.',
        };
      }

      if (token.message.includes('already verified')) {
        this.setStatus(409);
        return { message: 'Email already verified. Please log in.' };
      }

      this.setStatus(500);
      return { message: failedSendMessage };
    }

    await userService.update(user.id, {
      email_verification_token: token,
    });

    this.setStatus(200);
    return { message: 'Verification email sent successfully' };
  }

  @Post('/password/reset')
  @ValidateBody(resetPasswordSchema)
  async resetPassword(
    @Body() requestBody: ResetPasswordByEmailBody,
  ): Promise<{ message: string }> {
    const user = await userService.getByEmail(requestBody.email);
    if (!user) {
      this.setStatus(404);
      return { message: 'User not found' };
    }

    const existingResetToken = (user as any)?.reset_password_token as
      | string
      | null
      | undefined;

    if (existingResetToken) {
      const decodedExisting = decodeToken(
        existingResetToken,
        process.env.RESET_JWT_SECRET as string,
      );

      // If the existing token is still valid, block resending to prevent spamming.
      const isExpired = decodedExisting instanceof TokenExpiredError;
      const isInvalid = decodedExisting instanceof Error;

      if (!isExpired && !isInvalid) {
        this.setStatus(429);
        return {
          message:
            'A password reset email was already sent recently. Please check your inbox and try again later.',
        };
      }
    }

    let token: string | Error;
    try {
      token = await userService.sendPasswordResetMail(user);
    } catch {
      token = new Error('Failed to send password reset email');
    }

    if (token instanceof Error) {
      this.setStatus(500);
      return { message: 'Failed to reset password' };
    }

    // Persist the reset token only after the email send succeeded.
    const updatedUser = await userService.update(user.id, {
      reset_password_token: token,
    });

    if (!updatedUser) {
      this.setStatus(500);
      return { message: 'Failed to reset password' };
    }
    return { message: 'Password reset email sent successfully' };
  }

  @Patch('/password/reset/confirm')
  @ValidateBody(updatePasswordSchema)
  async confirmResetPassword(
    @Body() requestBody: ConfirmResetPasswordBody,
  ): Promise<{ message: string }> {
    const verifiedToken = decodeToken(
      requestBody.token,
      process.env.RESET_JWT_SECRET as string,
    ) as JwtPayload;

    if (verifiedToken instanceof TokenExpiredError) {
      this.setStatus(400);
      return { message: 'Token expired' };
    } else if (verifiedToken instanceof Error) {
      this.setStatus(400);
      return { message: 'Invalid token' };
    }
    const userId = verifiedToken.userId;
    const user = await userService.getById(userId);
    if (!user) {
      this.setStatus(404);
      return { message: 'User not found' };
    }

    const updatedUser = await userService.resetPassword(
      userId,
      requestBody.password,
      requestBody.token,
    );

    if (!updatedUser) {
      this.setStatus(500);
      return { message: 'Failed to reset password' };
    }

    this.setStatus(200);
    return { message: 'Password reset successfully' };
  }
}

const authController = new AuthController();
export default authController;
