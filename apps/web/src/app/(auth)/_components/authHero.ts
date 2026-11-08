/**
 * Auth visual system — Option A (split screen).
 * Decided after /prototype/auth comparison (2026-07-25).
 */

export type AuthHeroScreen =
  | 'login'
  | 'signup'
  | 'forgot'
  | 'check-email'
  | 'verify'
  | 'set-password';

export type AuthHeroCopy = {
  title: string;
  subtitle: string;
};

export const AUTH_HERO_COPY: Record<AuthHeroScreen, AuthHeroCopy> = {
  login: {
    title: 'Welcome back',
    subtitle: 'Your tasks, contacts, and vault — encrypted on your device.',
  },
  signup: {
    title: 'Welcome to MyOrganiser',
    subtitle:
      'Organize your life, secure your data — protected by client-side encryption.',
  },
  forgot: {
    title: 'Recover access',
    subtitle:
      'Reset securely. Resetting your account password does not decrypt or expose your Vault.',
  },
  'check-email': {
    title: 'Almost there',
    subtitle: 'Verify your email to unlock your secure workspace.',
  },
  verify: {
    title: 'You are verified',
    subtitle: 'Your account is ready. Privacy stays client-side.',
  },
  'set-password': {
    title: 'Secure your account',
    subtitle: 'A strong password protects access to your encrypted vault.',
  },
};
