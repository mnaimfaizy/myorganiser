/* eslint-disable import/first -- jest.mock must precede application imports */

jest.mock('@myorganiser/web-ui', () => ({
  Button: ({ onClick, disabled, children, ...props }: any) => (
    <button disabled={disabled} onClick={onClick} {...props}>
      {children}
    </button>
  ),
  Card: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  // Plain concatenation: the real cn also runs tailwind-merge, which these tests do not exercise.
  cn: (...inputs: unknown[]) => inputs.filter(Boolean).join(' '),
  CardContent: ({ children, ...props }: any) => (
    <div {...props}>{children}</div>
  ),
  CardDescription: ({ children, ...props }: any) => (
    <span {...props}>{children}</span>
  ),
  CardHeader: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  CardTitle: ({ children, ...props }: any) => <h2 {...props}>{children}</h2>,
  Label: ({ htmlFor, children }: any) => (
    <label htmlFor={htmlFor}>{children}</label>
  ),
  Select: ({ value, onValueChange, children, ...props }: any) => {
    // Extract the options from SelectContent > SelectItem children
    const options: any[] = [];

    function extractOptions(node: any): void {
      if (!node) return;
      if (Array.isArray(node)) {
        node.forEach(extractOptions);
        return;
      }
      if (node.type?.name === 'SelectContent' || node.props?.children) {
        const childList = node.props?.children || [];
        const childArray = Array.isArray(childList) ? childList : [childList];
        childArray.forEach((child: any) => {
          if (child?.type?.name === 'SelectItem') {
            options.push({
              value: child.props.value,
              label: child.props.children,
              testid: child.props['data-testid'],
            });
          }
        });
      }
    }

    const childArray = Array.isArray(children) ? children : [children];
    childArray.forEach(extractOptions);

    return (
      <select
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        data-testid="select-element"
        {...props}
      >
        {options.map((opt: any) => (
          <option key={opt.value} value={opt.value} data-testid={opt.testid}>
            {opt.label}
          </option>
        ))}
      </select>
    );
  },
  SelectTrigger: ({ children, ...props }: any) => (
    <div data-testid={props['data-testid']} {...props}>
      {children}
    </div>
  ),
  SelectValue: ({ placeholder }: any) => <span>{placeholder}</span>,
  SelectContent: ({ children, ...props }: any) => (
    <div data-testid="select-content" {...props}>
      {children}
    </div>
  ),
  SelectItem: ({ value, children, ...props }: any) => (
    <div data-value={value} {...props}>
      {children}
    </div>
  ),
}));

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';

import { CloudBackupCard, CloudBackupCardConnection } from './CloudBackupCard';

const noop = () => undefined;
const NOW = 1713139200000; // 2026-04-15T00:00:00Z in ms

function renderCard(
  overrides: Partial<React.ComponentProps<typeof CloudBackupCard>> = {},
) {
  const defaults: React.ComponentProps<typeof CloudBackupCard> = {
    connection: { status: 'not-linked' },
    ageLimit: 'off',
    latestRecord: null,
    now: NOW,
    onConnect: noop,
    onReconnect: noop,
    onDisconnect: noop,
    onBackupNow: noop,
    onRestore: noop,
    onAgeLimitChange: noop,
  };
  return render(<CloudBackupCard {...defaults} {...overrides} />);
}

function isDisabled(el: HTMLElement): boolean {
  return (
    el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true'
  );
}

describe('CloudBackupCard', () => {
  describe('connection states', () => {
    test('not-linked: shows badge and Connect button', () => {
      renderCard({ connection: { status: 'not-linked' } });
      expect(
        screen.getByTestId('cloud-backup-connection-not-linked'),
      ).toHaveTextContent('Not linked');
      expect(
        isDisabled(screen.getByTestId('cloud-backup-connect-button')),
      ).toBe(false);
    });

    test('linked: shows badge and Unlink, Back up now, Restore buttons', () => {
      renderCard({ connection: { status: 'linked' } });
      expect(
        screen.getByTestId('cloud-backup-connection-linked'),
      ).toHaveTextContent('Linked to Google Drive');
      expect(
        isDisabled(screen.getByTestId('cloud-backup-disconnect-button')),
      ).toBe(false);
      expect(isDisabled(screen.getByTestId('cloud-backup-now-button'))).toBe(
        false,
      );
      expect(
        isDisabled(screen.getByTestId('cloud-backup-restore-button')),
      ).toBe(false);
    });

    test('reconnect-needed: shows badge with/without reason, Reconnect and Unlink buttons', () => {
      const connWithReason: CloudBackupCardConnection = {
        status: 'reconnect-needed',
        reason: 'token expired',
      };
      renderCard({ connection: connWithReason });
      const badge = screen.getByTestId(
        'cloud-backup-connection-reconnect-needed',
      );
      expect(badge.textContent).toContain('Google Drive refused access');
      expect(badge.textContent).toContain('token expired');
      expect(screen.getByTestId('cloud-backup-reconnect-button')).toBeTruthy();

      // Also test without reason
      cleanup();
      render(
        <CloudBackupCard
          connection={{ status: 'reconnect-needed' }}
          ageLimit="off"
          latestRecord={null}
          now={NOW}
          onConnect={noop}
          onReconnect={noop}
          onDisconnect={noop}
          onBackupNow={noop}
          onRestore={noop}
          onAgeLimitChange={noop}
        />,
      );
      const badgeNoReason = screen.getByTestId(
        'cloud-backup-connection-reconnect-needed',
      );
      expect(badgeNoReason.textContent).toContain(
        'Google Drive refused access',
      );
      expect(badgeNoReason.textContent).not.toContain('(undefined)');
    });
  });

  describe('structure', () => {
    test('titles the card with a level 3 heading', () => {
      renderCard({ connection: { status: 'linked' } });
      expect(
        screen.getByRole('heading', {
          level: 3,
          name: 'Encrypted Escape Copy',
        }),
      ).toBeInTheDocument();
    });
  });

  describe('button enablement', () => {
    test('all buttons disabled when isBusy true', () => {
      renderCard({ connection: { status: 'linked' }, isBusy: true });
      expect(isDisabled(screen.getByTestId('cloud-backup-now-button'))).toBe(
        true,
      );
      expect(
        isDisabled(screen.getByTestId('cloud-backup-restore-button')),
      ).toBe(true);
      expect(
        isDisabled(screen.getByTestId('cloud-backup-disconnect-button')),
      ).toBe(true);
    });

    test('Reconnect button disabled when isBusy true in reconnect-needed state', () => {
      renderCard({
        connection: { status: 'reconnect-needed' },
        isBusy: true,
      });
      expect(
        isDisabled(screen.getByTestId('cloud-backup-reconnect-button')),
      ).toBe(true);
    });
  });

  describe('latest record display', () => {
    test('renders loading state when isLatestLoading true', () => {
      renderCard({ isLatestLoading: true });
      expect(screen.getByTestId('cloud-backup-latest-loading')).toBeTruthy();
    });

    test('renders empty state when latestRecord is null', () => {
      renderCard({ latestRecord: null });
      expect(screen.getByTestId('cloud-backup-latest-empty')).toHaveTextContent(
        'No copy in Google Drive yet',
      );
    });

    test('renders unknown state when latestRecord is undefined', () => {
      renderCard({ latestRecord: undefined });
      expect(
        screen.getByTestId('cloud-backup-latest-unknown'),
      ).toHaveTextContent('Newest copy: unknown');
    });

    test('renders recorded state with relative age from injected `now` and formatted date', () => {
      const threeDaysAgo = new Date(
        NOW - 3 * 24 * 60 * 60 * 1000,
      ).toISOString();
      renderCard({
        latestRecord: {
          source: 'google-drive',
          status: 'success',
          createdAt: threeDaysAgo,
        },
      });
      const recordEl = screen.getByTestId('cloud-backup-latest-recorded');
      expect(recordEl.textContent).toContain('3 days old');
      const timeEl = recordEl.querySelector('time');
      expect(timeEl?.getAttribute('dateTime')).toBe(threeDaysAgo);
      expect(timeEl?.getAttribute('title')).toBeTruthy();
    });
  });

  describe('overdue notice', () => {
    test('shows when isOverdue true, linked, with record', () => {
      const recordDate = new Date(NOW - 12 * 24 * 60 * 60 * 1000).toISOString();
      renderCard({
        connection: { status: 'linked' },
        isOverdue: true,
        ageLimit: '1-week',
        latestRecord: {
          source: 'google-drive',
          status: 'success',
          createdAt: recordDate,
        },
      });
      const overdue = screen.getByTestId('cloud-backup-overdue');
      expect(overdue).toHaveAttribute('role', 'status');
      expect(overdue.textContent).toContain('12 days old');
      expect(overdue.textContent).toContain('1 week');
    });

    test('shows when isOverdue true, reconnect-needed, with record', () => {
      const recordDate = new Date(NOW - 10 * 24 * 60 * 60 * 1000).toISOString();
      renderCard({
        connection: { status: 'reconnect-needed' },
        isOverdue: true,
        ageLimit: '1-week',
        latestRecord: {
          source: 'google-drive',
          status: 'success',
          createdAt: recordDate,
        },
      });
      const overdue = screen.getByTestId('cloud-backup-overdue');
      expect(overdue).toHaveAttribute('role', 'status');
      expect(overdue.textContent).toContain('10 days old');
      expect(overdue.textContent).toContain('1 week');
    });

    test('shows when isOverdue true, linked, without record', () => {
      renderCard({
        connection: { status: 'linked' },
        isOverdue: true,
        latestRecord: null,
      });
      const overdue = screen.getByTestId('cloud-backup-overdue');
      expect(overdue.textContent).toContain(
        'You have no copy in Google Drive yet',
      );
    });

    test('suppressed when isOverdue false or not-linked', () => {
      // Not linked case
      renderCard({
        connection: { status: 'not-linked' },
        isOverdue: true,
      });
      expect(screen.queryByTestId('cloud-backup-overdue')).toBeNull();

      // Not overdue case
      cleanup();
      render(
        <CloudBackupCard
          connection={{ status: 'linked' }}
          ageLimit="off"
          latestRecord={null}
          now={NOW}
          isOverdue={false}
          onConnect={noop}
          onReconnect={noop}
          onDisconnect={noop}
          onBackupNow={noop}
          onRestore={noop}
          onAgeLimitChange={noop}
        />,
      );
      expect(screen.queryByTestId('cloud-backup-overdue')).toBeNull();
    });
  });

  describe('age limit selector', () => {
    test('calls onAgeLimitChange when selection changes', () => {
      const onAgeLimitChange = jest.fn();
      renderCard({ ageLimit: 'off', onAgeLimitChange });
      const selectElement = screen.getByTestId(
        'select-element',
      ) as HTMLSelectElement;
      fireEvent.change(selectElement, { target: { value: '1-week' } });
      expect(onAgeLimitChange).toHaveBeenCalledWith('1-week');
    });
  });

  describe('error display', () => {
    test('shows error with role="alert" when lastError provided; hidden otherwise', () => {
      // With error
      renderCard({ lastError: 'upload failed' });
      const errorEl = screen.getByTestId('cloud-backup-error');
      expect(errorEl).toHaveAttribute('role', 'alert');
      expect(errorEl.textContent).toBe('upload failed');

      // Without error (null or undefined)
      cleanup();
      render(
        <CloudBackupCard
          connection={{ status: 'linked' }}
          ageLimit="off"
          latestRecord={null}
          now={NOW}
          lastError={null}
          onConnect={noop}
          onReconnect={noop}
          onDisconnect={noop}
          onBackupNow={noop}
          onRestore={noop}
          onAgeLimitChange={noop}
        />,
      );
      expect(screen.queryByTestId('cloud-backup-error')).toBeNull();
    });
  });

  describe('callbacks', () => {
    test('onConnect called when Connect button clicked', () => {
      const onConnect = jest.fn();
      renderCard({ connection: { status: 'not-linked' }, onConnect });
      fireEvent.click(screen.getByTestId('cloud-backup-connect-button'));
      expect(onConnect).toHaveBeenCalledTimes(1);
    });

    test('onBackupNow called when Back up now button clicked', () => {
      const onBackupNow = jest.fn();
      renderCard({ connection: { status: 'linked' }, onBackupNow });
      fireEvent.click(screen.getByTestId('cloud-backup-now-button'));
      expect(onBackupNow).toHaveBeenCalledTimes(1);
    });

    test('onRestore called when Restore button clicked', () => {
      const onRestore = jest.fn();
      renderCard({ connection: { status: 'linked' }, onRestore });
      fireEvent.click(screen.getByTestId('cloud-backup-restore-button'));
      expect(onRestore).toHaveBeenCalledTimes(1);
    });

    test('onDisconnect called when Unlink button clicked', () => {
      const onDisconnect = jest.fn();
      renderCard({ connection: { status: 'linked' }, onDisconnect });
      fireEvent.click(screen.getByTestId('cloud-backup-disconnect-button'));
      expect(onDisconnect).toHaveBeenCalledTimes(1);
    });

    test('onReconnect called when Reconnect button clicked', () => {
      const onReconnect = jest.fn();
      renderCard({
        connection: { status: 'reconnect-needed' },
        onReconnect,
      });
      fireEvent.click(screen.getByTestId('cloud-backup-reconnect-button'));
      expect(onReconnect).toHaveBeenCalledTimes(1);
    });
  });

  describe('edge cases', () => {
    test('renders with custom provider label', () => {
      renderCard({
        connection: { status: 'linked' },
        providerLabel: 'OneDrive',
      });
      expect(
        screen.getByTestId('cloud-backup-connection-linked'),
      ).toHaveTextContent('Linked to OneDrive');
    });

    test('renders with custom className', () => {
      const { container } = renderCard({ className: 'custom-class' });
      expect(container.querySelector('.custom-class')).toBeTruthy();
    });
  });
});
