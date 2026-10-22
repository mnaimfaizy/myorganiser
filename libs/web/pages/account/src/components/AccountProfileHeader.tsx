import { initialsOf, type AccountVariant } from '../account-view';

interface AccountProfileHeaderProps {
  variant: AccountVariant;
  name: string;
  email: string;
}

export function AccountProfileHeader({
  variant,
  name,
  email,
}: AccountProfileHeaderProps) {
  const displayName = name || email;
  const initials = initialsOf(name) || email.charAt(0).toUpperCase();

  if (variant === 'phone') {
    return (
      <section aria-label="Profile" className="flex items-center gap-3.5">
        <span
          aria-hidden="true"
          className="flex size-14 shrink-0 items-center justify-center rounded-full bg-brand font-display text-title font-bold text-brand-foreground"
        >
          {initials}
        </span>
        <div className="flex min-w-0 flex-col">
          <h1 className="font-display text-title-lg font-extrabold tracking-tight break-words">
            {displayName}
          </h1>
          {name && (
            <span className="text-control-sm text-muted-foreground">
              {email}
            </span>
          )}
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="Profile"
      className="flex flex-wrap items-center gap-4.5 rounded-2xl bg-navy p-6 text-navy-foreground"
    >
      <span
        aria-hidden="true"
        className="flex size-18 shrink-0 items-center justify-center rounded-full bg-brand font-display text-title-lg font-bold text-brand-foreground"
      >
        {initials}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h1 className="font-display text-title-lg font-bold tracking-tight break-words">
          {displayName}
        </h1>
        {name && (
          <span className="text-body text-navy-muted-foreground">{email}</span>
        )}
      </div>
      <span className="inline-flex h-7 items-center rounded-full bg-trust-text px-3 text-label-caps text-trust-edge">
        EMAIL VERIFIED
      </span>
    </section>
  );
}
