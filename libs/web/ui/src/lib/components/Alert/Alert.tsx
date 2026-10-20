import * as React from 'react';
import { cva } from 'class-variance-authority';
import {
  CircleAlert,
  CircleCheck,
  Lock,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '../../utils';

export type AlertTone = 'trust' | 'warning' | 'danger' | 'success';

/**
 * The bar is a solid, full-width strip for the offline and back-online state.
 * Only warning and success are meaningful there (Feedback and PhoneOverlays
 * artboards), so the type restricts the bar to them.
 */
export type AlertBarTone = 'warning' | 'success';

export type AlertVariant = 'banner' | 'notice' | 'bar';

// banner and notice: a faint ground with an edge.
const alertSurface = {
  trust: 'bg-trust-faint border-trust-edge',
  warning: 'bg-warning-faint border-warning-edge',
  danger: 'bg-destructive-faint border-destructive-edge',
  success: 'bg-success-faint border-success-edge',
} as const satisfies Record<AlertTone, string>;

// banner title and notice caption: the -text ink on the faint ground.
const alertInk = {
  trust: 'text-trust-text',
  warning: 'text-warning-text',
  danger: 'text-destructive-text',
  success: 'text-success-text',
} as const satisfies Record<AlertTone, string>;

// bar: a solid ground with its -foreground ink on top.
const alertBarSurface = {
  warning: 'bg-warning text-warning-foreground',
  success: 'bg-success text-success-foreground',
} as const satisfies Record<AlertBarTone, string>;

// banner only: the 20px tone icon, in the tone's base ink.
const alertIcon = {
  trust: { Icon: Lock, ink: 'text-trust' },
  warning: { Icon: TriangleAlert, ink: 'text-warning' },
  danger: { Icon: CircleAlert, ink: 'text-destructive' },
  success: { Icon: CircleCheck, ink: 'text-success' },
} as const satisfies Record<AlertTone, { Icon: LucideIcon; ink: string }>;

const alertVariants = cva('', {
  variants: {
    variant: {
      // A grid so the title and description share a column and the action
      // sits on the right, whatever order the consumer writes them in.
      banner:
        'grid grid-cols-[auto_minmax(0,1fr)_auto] items-start rounded-xl border py-3.5 pr-3.5 pl-4',
      notice:
        'flex items-center gap-3 rounded-control border py-2.5 pr-2 pl-3.5',
      bar: 'flex min-h-10 w-full items-center gap-2 px-4 py-2 text-body-sm font-semibold [&_svg]:shrink-0',
    },
  },
  defaultVariants: {
    variant: 'banner',
  },
});

interface AlertContextValue {
  variant: AlertVariant;
  tone: AlertTone;
}

const AlertContext = React.createContext<AlertContextValue | null>(null);

function useAlertContext(): AlertContextValue {
  const context = React.useContext(AlertContext);
  if (!context) {
    throw new Error('Alert sub-components must be rendered inside <Alert>.');
  }
  return context;
}

export interface AlertBannerProps extends React.HTMLAttributes<HTMLDivElement> {
  variant: Exclude<AlertVariant, 'bar'>;
  tone: AlertTone;
}

export interface AlertBarProps extends React.HTMLAttributes<HTMLDivElement> {
  variant: 'bar';
  tone: AlertBarTone;
}

export type AlertProps = AlertBannerProps | AlertBarProps;

const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  ({ className, variant, tone, role, children, ...props }, ref) => {
    const contextValue = React.useMemo<AlertContextValue>(
      () => ({ variant, tone }),
      [variant, tone],
    );
    const iconSpec = variant === 'banner' ? alertIcon[tone] : undefined;
    const surface =
      variant === 'bar' ? alertBarSurface[tone] : alertSurface[tone];

    return (
      <div
        ref={ref}
        role={role ?? (tone === 'danger' ? 'alert' : 'status')}
        className={cn(alertVariants({ variant }), surface, className)}
        {...props}
      >
        {iconSpec ? (
          <iconSpec.Icon
            aria-hidden="true"
            className={cn(
              'col-start-1 row-span-2 row-start-1 mr-3 size-5 shrink-0',
              iconSpec.ink,
            )}
          />
        ) : null}
        <AlertContext.Provider value={contextValue}>
          {children}
        </AlertContext.Provider>
      </div>
    );
  },
);
Alert.displayName = 'Alert';

const AlertTitle = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => {
  const { variant, tone } = useAlertContext();
  return (
    <div
      ref={ref}
      className={cn(
        variant === 'banner' &&
          'col-start-2 row-start-1 min-w-0 text-body-sm font-semibold',
        variant === 'banner' && alertInk[tone],
        className,
      )}
      {...props}
    />
  );
});
AlertTitle.displayName = 'AlertTitle';

const AlertDescription = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => {
  const { variant, tone } = useAlertContext();
  return (
    <div
      ref={ref}
      className={cn(
        variant === 'banner' &&
          'col-start-2 row-start-2 min-w-0 text-caption text-foreground-secondary',
        variant === 'notice' && 'min-w-0 flex-1 text-caption',
        variant === 'notice' && alertInk[tone],
        className,
      )}
      {...props}
    />
  );
});
AlertDescription.displayName = 'AlertDescription';

/** A slot for one caller Button, normally `size="sm" variant="outline"`. */
const AlertAction = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => {
  const { variant } = useAlertContext();
  return (
    <div
      ref={ref}
      className={cn(
        'shrink-0',
        variant === 'banner' &&
          'col-start-3 row-span-2 row-start-1 ml-3 self-center',
        className,
      )}
      {...props}
    />
  );
});
AlertAction.displayName = 'AlertAction';

export { Alert, AlertTitle, AlertDescription, AlertAction };
