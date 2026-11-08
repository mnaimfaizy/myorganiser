/* eslint-disable import/first */
const mockRenderRealForm = { enabled: false };

jest.mock('./FeedbackReportForm', () => {
  const actual = jest.requireActual('./FeedbackReportForm');
  return {
    FeedbackReportForm: jest.fn((props) =>
      mockRenderRealForm.enabled ? (
        <actual.FeedbackReportForm {...props} />
      ) : (
        <div data-testid="feedback-report-form">
          <button onClick={props.onSent}>Form Send</button>
          <button onClick={props.onCancel}>Form Cancel</button>
        </div>
      ),
    ),
  };
});

jest.mock('next/navigation', () => ({
  usePathname: jest.fn(),
}));

jest.mock('../lib/apiClient', () => ({
  createFeedbackApi: jest.fn(),
}));

jest.mock('@myorganiser/web-ui', () => ({
  ...jest.requireActual('@myorganiser/web-ui'),
  useIsMobileState: jest.fn(),
  useToast: jest.fn(),
}));

import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
  within,
} from '@testing-library/react';
import '@testing-library/jest-dom';
import { usePathname } from 'next/navigation';
import { FEEDBACK_REPORT_REQUIRED_MESSAGES } from '@myorganiser/core';
import {
  openFeedbackDialog,
  setFeedbackDialogOpen,
  useIsMobileState,
  useToast,
} from '@myorganiser/web-ui';
import { createFeedbackApi } from '../lib/apiClient';
import { FeedbackDialog } from './FeedbackDialog';

// Polyfill ResizeObserver for Radix UI components used by the real form
global.ResizeObserver = jest.fn().mockImplementation(() => ({
  observe: jest.fn(),
  unobserve: jest.fn(),
  disconnect: jest.fn(),
}));

const mockCreateReport = jest.fn();
const mockToast = jest.fn();

describe('FeedbackDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default to the desktop breakpoint; phone tests override this.
    (useIsMobileState as jest.Mock).mockReturnValue(false);
    (useToast as jest.Mock).mockReturnValue({ toast: mockToast });
    (usePathname as jest.Mock).mockReturnValue('/dashboard/tasks');
    (createFeedbackApi as jest.Mock).mockReturnValue({
      createReport: mockCreateReport,
    });
    // Reset module-level store since it survives between tests
    setFeedbackDialogOpen(false);
  });

  it('should render no dialog content when closed', () => {
    render(<FeedbackDialog />);

    // When closed, the Dialog itself renders but DialogContent should not be visible
    expect(screen.queryByText('Send feedback')).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('feedback-report-form'),
    ).not.toBeInTheDocument();
  });

  it('should render dialog content when opened via openFeedbackDialog', async () => {
    render(<FeedbackDialog />);

    // Initially closed
    expect(screen.queryByText('Send feedback')).not.toBeInTheDocument();

    // Open the dialog
    await act(async () => {
      openFeedbackDialog();
    });

    // Now the dialog title and content should be visible
    expect(screen.getByText('Send feedback')).toBeInTheDocument();
    expect(
      screen.getByText('Help us improve MyOrganiser by sharing your thoughts.'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('feedback-report-form')).toBeInTheDocument();
  });

  it('should close the dialog when the form calls onSent', async () => {
    render(<FeedbackDialog />);

    // Open the dialog
    await act(async () => {
      openFeedbackDialog();
    });
    expect(screen.getByText('Send feedback')).toBeInTheDocument();

    // Trigger onSent from the form
    await act(async () => {
      fireEvent.click(screen.getByText('Form Send'));
    });

    // Dialog should close
    expect(screen.queryByText('Send feedback')).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('feedback-report-form'),
    ).not.toBeInTheDocument();
  });

  it('should close the dialog when the form calls onCancel', async () => {
    render(<FeedbackDialog />);

    // Open the dialog
    await act(async () => {
      openFeedbackDialog();
    });
    expect(screen.getByText('Send feedback')).toBeInTheDocument();

    // Trigger onCancel from the form
    await act(async () => {
      fireEvent.click(screen.getByText('Form Cancel'));
    });

    // Dialog should close
    expect(screen.queryByText('Send feedback')).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('feedback-report-form'),
    ).not.toBeInTheDocument();
  });

  it('should close the dialog when onOpenChange is called with false', async () => {
    render(<FeedbackDialog />);

    // Open the dialog
    await act(async () => {
      openFeedbackDialog();
    });
    expect(screen.getByText('Send feedback')).toBeInTheDocument();

    // Close via external state change
    await act(async () => {
      setFeedbackDialogOpen(false);
    });

    // Dialog should close
    expect(screen.queryByText('Send feedback')).not.toBeInTheDocument();
  });

  describe('breakpoint layouts with the real form', () => {
    beforeEach(() => {
      mockRenderRealForm.enabled = true;
    });

    afterEach(() => {
      mockRenderRealForm.enabled = false;
    });

    it('should render nothing while the breakpoint is undecided, even when open', async () => {
      (useIsMobileState as jest.Mock).mockReturnValue(undefined);
      render(<FeedbackDialog />);

      await act(async () => {
        openFeedbackDialog();
      });

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.queryByText('Send feedback')).not.toBeInTheDocument();
    });

    it('should render a phone sheet named "Send feedback" with Cancel and Send report in its header', async () => {
      (useIsMobileState as jest.Mock).mockReturnValue(true);
      render(<FeedbackDialog />);

      await act(async () => {
        openFeedbackDialog();
      });

      const sheet = screen.getByRole('dialog', { name: 'Send feedback' });
      expect(
        within(sheet).getByRole('button', { name: 'Cancel' }),
      ).toBeInTheDocument();
      expect(
        within(sheet).getByRole('button', { name: 'Send report' }),
      ).toBeInTheDocument();
      expect(
        screen.getAllByRole('button', { name: 'Send report' }),
      ).toHaveLength(1);
    });

    it('should close the phone sheet when the header Cancel is clicked', async () => {
      (useIsMobileState as jest.Mock).mockReturnValue(true);
      render(<FeedbackDialog />);

      await act(async () => {
        openFeedbackDialog();
      });

      const sheet = screen.getByRole('dialog', { name: 'Send feedback' });
      await act(async () => {
        fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }));
      });

      expect(
        screen.queryByRole('dialog', { name: 'Send feedback' }),
      ).not.toBeInTheDocument();
      expect(mockCreateReport).not.toHaveBeenCalled();
    });

    it('should send the report from the header Send report with the desktop payload shape, then close', async () => {
      (useIsMobileState as jest.Mock).mockReturnValue(true);
      mockCreateReport.mockResolvedValue({ id: 'report-123' });
      render(<FeedbackDialog />);

      await act(async () => {
        openFeedbackDialog();
      });

      const sheet = screen.getByRole('dialog', { name: 'Send feedback' });
      fireEvent.change(within(sheet).getByRole('textbox', { name: 'Title' }), {
        target: { value: 'Login button not responsive' },
      });
      fireEvent.change(
        within(sheet).getByRole('textbox', { name: 'What happened?' }),
        {
          target: {
            value: 'Clicking the login button does nothing on the home page.',
          },
        },
      );

      await act(async () => {
        fireEvent.click(
          within(sheet).getByRole('button', { name: 'Send report' }),
        );
      });

      await waitFor(() => {
        expect(mockCreateReport).toHaveBeenCalledTimes(1);
      });

      const call = mockCreateReport.mock.calls[0][0];
      expect(call.createFeedbackReportRequest).toEqual(
        expect.objectContaining({
          kind: 'bug_report',
          title: 'Login button not responsive',
          description:
            'Clicking the login button does nothing on the home page.',
          fixNoticeOptIn: true,
          context: expect.objectContaining({
            platform: 'web',
            path: '/dashboard/tasks',
          }),
        }),
      );

      await waitFor(() => {
        expect(
          screen.queryByRole('dialog', { name: 'Send feedback' }),
        ).not.toBeInTheDocument();
      });
    });

    it.each([
      ['desktop to phone', false, true],
      ['phone to desktop', true, false],
    ])(
      'should keep every typed value when the breakpoint crosses %s',
      async (_name, startsPhone, endsPhone) => {
        (useIsMobileState as jest.Mock).mockReturnValue(startsPhone);
        const { rerender } = render(<FeedbackDialog />);

        await act(async () => {
          openFeedbackDialog();
        });

        fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), {
          target: { value: 'Login button not responsive' },
        });
        fireEvent.change(
          screen.getByRole('textbox', { name: 'What happened?' }),
          { target: { value: 'Clicking login does nothing.' } },
        );
        fireEvent.change(
          screen.getByRole('textbox', { name: /What did you expect/ }),
          { target: { value: 'It should sign me in.' } },
        );

        (useIsMobileState as jest.Mock).mockReturnValue(endsPhone);
        await act(async () => {
          rerender(<FeedbackDialog />);
        });

        expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue(
          'Login button not responsive',
        );
        expect(
          screen.getByRole('textbox', { name: 'What happened?' }),
        ).toHaveValue('Clicking login does nothing.');
        expect(
          screen.getByRole('textbox', { name: /What did you expect/ }),
        ).toHaveValue('It should sign me in.');
      },
    );

    it('should keep the chosen kind when the breakpoint crosses', async () => {
      (useIsMobileState as jest.Mock).mockReturnValue(false);
      const { rerender } = render(<FeedbackDialog />);

      await act(async () => {
        openFeedbackDialog();
      });

      fireEvent.click(screen.getByRole('radio', { name: /Suggestion/ }));
      fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), {
        target: { value: 'Dark mode' },
      });

      (useIsMobileState as jest.Mock).mockReturnValue(true);
      await act(async () => {
        rerender(<FeedbackDialog />);
      });

      expect(screen.getByRole('radio', { name: /Suggestion/ })).toBeChecked();
      expect(
        screen.getByRole('textbox', { name: 'What would you like to see?' }),
      ).toBeInTheDocument();
      expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue(
        'Dark mode',
      );
    });

    it('should start blank after the dialog is closed and reopened', async () => {
      render(<FeedbackDialog />);

      await act(async () => {
        openFeedbackDialog();
      });
      fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), {
        target: { value: 'Stale draft' },
      });

      await act(async () => {
        setFeedbackDialogOpen(false);
      });
      await act(async () => {
        openFeedbackDialog();
      });

      expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('');
    });

    it('should show the title required message and keep the phone sheet open on an empty submit', async () => {
      (useIsMobileState as jest.Mock).mockReturnValue(true);
      render(<FeedbackDialog />);

      await act(async () => {
        openFeedbackDialog();
      });

      const sheet = screen.getByRole('dialog', { name: 'Send feedback' });
      await act(async () => {
        fireEvent.click(
          within(sheet).getByRole('button', { name: 'Send report' }),
        );
      });

      await waitFor(() => {
        expect(
          within(sheet).getByText(FEEDBACK_REPORT_REQUIRED_MESSAGES.title),
        ).toBeInTheDocument();
      });

      expect(mockCreateReport).not.toHaveBeenCalled();
      expect(
        screen.getByRole('dialog', { name: 'Send feedback' }),
      ).toBeInTheDocument();
    });
  });
});
