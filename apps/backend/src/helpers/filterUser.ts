import {
  AdminUserIdentity,
  FilteredUserInterface,
  UserInterface,
  UserRole,
} from '../types';

function resolveRole(user: UserInterface | Record<string, unknown>): UserRole {
  const role = (user as { role?: unknown }).role;
  return role === 'platform_admin' ? 'platform_admin' : 'user';
}

function resolveDisabled(
  user: UserInterface | Record<string, unknown>,
): boolean {
  return Boolean((user as { disabled?: unknown }).disabled);
}

export default (user: UserInterface): FilteredUserInterface => {
  const { id, name, email } = user;
  const firstName = (user.first_name ?? '').trim();
  const lastName = (user.last_name ?? '').trim();
  const phone = user.phone ?? undefined;
  return {
    id,
    name,
    email,
    firstName,
    lastName,
    phone,
    role: resolveRole(user),
    disabled: resolveDisabled(user),
  };
};

export function toAdminUserIdentity(
  user: UserInterface | Record<string, unknown>,
): AdminUserIdentity {
  const record = user as UserInterface & {
    first_name?: string;
    last_name?: string;
    email_verification_timestamp?: Date | null;
    youtube_access?: boolean;
    created_at: Date;
  };
  const firstName = (record.first_name ?? '').trim();
  const lastName = (record.last_name ?? '').trim();
  const phone = record.phone ?? undefined;
  const emailVerified = Boolean(
    record.email_verification_timestamp ?? record.email_verified_at,
  );

  return {
    id: record.id,
    name: record.name ?? `${firstName} ${lastName}`.trim(),
    email: record.email,
    firstName,
    lastName,
    phone,
    role: resolveRole(record),
    disabled: resolveDisabled(record),
    emailVerified,
    youtubeAccess: record.youtube_access === true,
    createdAt: record.created_at,
  };
}
