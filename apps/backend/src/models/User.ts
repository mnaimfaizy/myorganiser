export type UserRole = 'user' | 'platform_admin';

export interface User {
  id: string;
  name?: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  email: string;
  password?: string;
  reset_password_token?: string;
  email_verification_timestamp?: Date;
  email_verification_token?: string | null;
  blacklisted_tokens?: string[];
  role?: UserRole;
  disabled?: boolean;
  /** When the User last successfully refreshed a Session (UTC day granularity). */
  last_active_at?: Date | null;
}

export interface UserCreationBody {
  name?: string;
  firstName: string;
  lastName: string;
  phone?: string;
  email: string;
  password: string;
}

export interface UserLoginBody {
  email: string;
  password: string;
  client_type?: 'mobile' | 'web';
}

export interface ConfirmResetPasswordBody {
  token: string;
  password: string;
  confirm_password: string;
}

export interface ResetPasswordByEmailBody {
  email: string;
}
