export class UserNotFoundError extends Error {
  status = 404;

  constructor(message = 'User not found') {
    super(message);
    this.name = 'UserNotFoundError';
  }
}

export class LastPlatformAdminError extends Error {
  status = 409;

  constructor(message = 'Cannot demote the last Platform Admin') {
    super(message);
    this.name = 'LastPlatformAdminError';
  }
}

export class SelfLifecycleActionError extends Error {
  status = 409;

  constructor(action: 'disable' | 'demote') {
    super(`You can't ${action} your own account`);
    this.name = 'SelfLifecycleActionError';
  }
}

export class EmailAlreadyVerifiedError extends Error {
  status = 409;

  constructor(message = 'Email already verified') {
    super(message);
    this.name = 'EmailAlreadyVerifiedError';
  }
}

export class VerificationCooldownError extends Error {
  status = 429;

  constructor(
    message = 'A verification email was already sent recently. Please try again later.',
  ) {
    super(message);
    this.name = 'VerificationCooldownError';
  }
}

export class VerificationSendFailedError extends Error {
  status = 500;

  constructor(message = 'Failed to send verification email') {
    super(message);
    this.name = 'VerificationSendFailedError';
  }
}

export class YouTubeAccessCeilingReachedError extends Error {
  status = 409;

  constructor(everGranted: number, ceiling: number) {
    super(
      `YouTube Access ceiling reached: ${everGranted} of ${ceiling} places used. Raise YOUTUBE_ACCESS_CEILING to grant more.`,
    );
    this.name = 'YouTubeAccessCeilingReachedError';
  }
}
