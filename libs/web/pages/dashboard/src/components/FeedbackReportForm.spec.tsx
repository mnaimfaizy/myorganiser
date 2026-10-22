/* eslint-disable import/first */
jest.mock('next/navigation', () => ({
  usePathname: jest.fn(),
}));

jest.mock('../lib/apiClient', () => ({
  createFeedbackApi: jest.fn(),
}));

jest.mock('@myorganiser/web-ui', () => ({
  ...jest.requireActual('@myorganiser/web-ui'),
  useToast: jest.fn(),
}));

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { usePathname } from 'next/navigation';

// Polyfill ResizeObserver for Radix UI components
global.ResizeObserver = jest.fn().mockImplementation(() => ({
  observe: jest.fn(),
  unobserve: jest.fn(),
  disconnect: jest.fn(),
}));
import { useToast } from '@myorganiser/web-ui';
import { createFeedbackApi } from '../lib/apiClient';
import { setFeedbackDialogOpen } from '../hooks/use-feedback-dialog';
import { FeedbackReportForm } from './FeedbackReportForm';

const mockCreateReport = jest.fn();
const mockToast = jest.fn();

function setupMocks() {
  (usePathname as jest.Mock).mockReturnValue('/dashboard/tasks');
  (useToast as jest.Mock).mockReturnValue({ toast: mockToast });
  (createFeedbackApi as jest.Mock).mockReturnValue({
    createReport: mockCreateReport,
  });
}

function renderForm(onSent = jest.fn(), onCancel = jest.fn()) {
  return render(<FeedbackReportForm onSent={onSent} onCancel={onCancel} />);
}

describe('FeedbackReportForm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupMocks();
    // Reset module-level store since it survives between tests
    setFeedbackDialogOpen(false);
  });

  describe('Report Context preview', () => {
    it('should strip query string and fragment from pathname in the Page row', () => {
      (usePathname as jest.Mock).mockReturnValue(
        '/dashboard/tasks?token=secret&filter=active#top',
      );
      renderForm();

      // Find the report context preview by looking for "Sent with your report" heading
      const heading = screen.getByText(/Sent with your report/);
      const previewSection = heading.parentElement;

      // The path should be stripped of query string and fragment
      expect(previewSection?.textContent).toContain('/dashboard/tasks');
      expect(previewSection?.textContent).not.toContain('token');
      expect(previewSection?.textContent).not.toContain('secret');
      expect(previewSection?.textContent).not.toContain('#top');
    });

    it('should render all required context preview rows', () => {
      renderForm();

      // Check all required rows are present
      expect(screen.getByText(/App:/)).toBeInTheDocument();
      expect(screen.getByText(/Browser:/)).toBeInTheDocument();
      expect(screen.getByText(/Operating system:/)).toBeInTheDocument();
      expect(screen.getByText(/Page:/)).toBeInTheDocument();
      expect(screen.getByText(/Time:/)).toBeInTheDocument();
    });

    it('should render the not-encrypted warning', () => {
      renderForm();

      const warning = screen.getByText(/This report is not encrypted/);
      expect(warning).toBeInTheDocument();
      expect(warning.textContent).toContain('vault');
    });
  });

  describe('Fix Notice opt-in', () => {
    it('should default to checked', () => {
      renderForm();

      const checkbox = screen.getByRole('checkbox', {
        name: /Email me when this is fixed/,
      });
      expect(checkbox).toBeChecked();
    });
  });

  describe('Expected outcome field', () => {
    it('should render for bug_report kind (default)', () => {
      renderForm();

      expect(
        screen.getByLabelText(/What did you expect to happen/),
      ).toBeInTheDocument();
    });

    it('should disappear when kind is switched to Suggestion', () => {
      renderForm();

      expect(
        screen.getByLabelText(/What did you expect to happen/),
      ).toBeInTheDocument();

      const suggestionRadio = screen.getByRole('radio', { name: /Suggestion/ });
      fireEvent.click(suggestionRadio);

      expect(
        screen.queryByLabelText(/What did you expect to happen/),
      ).not.toBeInTheDocument();
    });
  });

  describe('Form validation', () => {
    it('should show validation errors on empty submit', async () => {
      renderForm();

      const submitButton = screen.getByRole('button', { name: /Send report/ });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText('Enter a title.')).toBeInTheDocument();
        expect(screen.getByText('Enter a description.')).toBeInTheDocument();
      });

      expect(mockCreateReport).not.toHaveBeenCalled();
    });

    it('should show error when title exceeds 120 characters', async () => {
      renderForm();

      const titleInput = screen.getByPlaceholderText(
        /Brief summary/,
      ) as HTMLInputElement;
      const longTitle = 'a'.repeat(121);
      fireEvent.change(titleInput, { target: { value: longTitle } });

      const submitButton = screen.getByRole('button', { name: /Send report/ });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(
          screen.getByText('The title must be 120 characters or fewer.'),
        ).toBeInTheDocument();
      });

      expect(mockCreateReport).not.toHaveBeenCalled();
    });

    it('should show error when description exceeds 4,000 characters', async () => {
      renderForm();

      const titleInput = screen.getByPlaceholderText(
        /Brief summary/,
      ) as HTMLInputElement;
      const descInput = screen.getByPlaceholderText(
        /Please provide details/,
      ) as HTMLTextAreaElement;

      fireEvent.change(titleInput, { target: { value: 'Valid title' } });
      const longDesc = 'x'.repeat(4001);
      fireEvent.change(descInput, { target: { value: longDesc } });

      const submitButton = screen.getByRole('button', { name: /Send report/ });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(
          screen.getByText(
            'The description must be 4,000 characters or fewer.',
          ),
        ).toBeInTheDocument();
      });

      expect(mockCreateReport).not.toHaveBeenCalled();
    });
  });

  describe('Successful submission', () => {
    it('should send a bug report with all required fields and call onSent', async () => {
      const onSent = jest.fn();
      mockCreateReport.mockResolvedValue({ id: 'report-123' });

      renderForm(onSent);

      const titleInput = screen.getByPlaceholderText(
        /Brief summary/,
      ) as HTMLInputElement;
      const descInput = screen.getByPlaceholderText(
        /Please provide details/,
      ) as HTMLTextAreaElement;

      fireEvent.change(titleInput, {
        target: { value: 'Login button not responsive' },
      });
      fireEvent.change(descInput, {
        target: {
          value: 'Clicking the login button does nothing on the home page.',
        },
      });

      const submitButton = screen.getByRole('button', { name: /Send report/ });
      fireEvent.click(submitButton);

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
        }),
      );

      // Verify context is included with stripped path
      expect(call.createFeedbackReportRequest.context).toEqual(
        expect.objectContaining({
          path: '/dashboard/tasks',
          platform: 'web',
        }),
      );

      expect(onSent).toHaveBeenCalledTimes(1);
    });

    it('should send expectedOutcome when provided for a bug report', async () => {
      const onSent = jest.fn();
      mockCreateReport.mockResolvedValue({ id: 'report-123' });

      renderForm(onSent);

      const titleInput = screen.getByPlaceholderText(
        /Brief summary/,
      ) as HTMLInputElement;
      const descInput = screen.getByPlaceholderText(
        /Please provide details/,
      ) as HTMLTextAreaElement;
      const outcomeInput = screen.getByPlaceholderText(
        /Describe what should have happened/,
      ) as HTMLTextAreaElement;

      fireEvent.change(titleInput, { target: { value: 'Button bug' } });
      fireEvent.change(descInput, { target: { value: 'Button not working' } });
      fireEvent.change(outcomeInput, {
        target: { value: 'Button should be clickable' },
      });

      const submitButton = screen.getByRole('button', { name: /Send report/ });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(mockCreateReport).toHaveBeenCalledTimes(1);
      });

      const call = mockCreateReport.mock.calls[0][0];
      expect(call.createFeedbackReportRequest.expectedOutcome).toBe(
        'Button should be clickable',
      );
    });

    it('should not send expectedOutcome when empty for a bug report', async () => {
      const onSent = jest.fn();
      mockCreateReport.mockResolvedValue({ id: 'report-123' });

      renderForm(onSent);

      const titleInput = screen.getByPlaceholderText(
        /Brief summary/,
      ) as HTMLInputElement;
      const descInput = screen.getByPlaceholderText(
        /Please provide details/,
      ) as HTMLTextAreaElement;

      fireEvent.change(titleInput, { target: { value: 'Button bug' } });
      fireEvent.change(descInput, { target: { value: 'Button not working' } });

      const submitButton = screen.getByRole('button', { name: /Send report/ });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(mockCreateReport).toHaveBeenCalledTimes(1);
      });

      const call = mockCreateReport.mock.calls[0][0];
      expect(call.createFeedbackReportRequest.expectedOutcome).toBeUndefined();
    });

    it('should send with fixNoticeOptIn: false when checkbox is unchecked', async () => {
      const onSent = jest.fn();
      mockCreateReport.mockResolvedValue({ id: 'report-123' });

      renderForm(onSent);

      const checkbox = screen.getByRole('checkbox', {
        name: /Email me when this is fixed/,
      }) as HTMLInputElement;
      fireEvent.click(checkbox);

      const titleInput = screen.getByPlaceholderText(
        /Brief summary/,
      ) as HTMLInputElement;
      const descInput = screen.getByPlaceholderText(
        /Please provide details/,
      ) as HTMLTextAreaElement;

      fireEvent.change(titleInput, { target: { value: 'Bug report' } });
      fireEvent.change(descInput, { target: { value: 'This is a bug' } });

      const submitButton = screen.getByRole('button', { name: /Send report/ });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(mockCreateReport).toHaveBeenCalledTimes(1);
      });

      const call = mockCreateReport.mock.calls[0][0];
      expect(call.createFeedbackReportRequest.fixNoticeOptIn).toBe(false);
    });
  });

  describe('Server errors', () => {
    it('should show 4xx error message from server', async () => {
      const onSent = jest.fn();
      // Create a proper mock axios error
      mockCreateReport.mockRejectedValue({
        isAxiosError: true,
        config: {},
        response: {
          status: 429,
          data: {
            message:
              'You have sent too many reports today. Please try again later.',
          },
        },
      });

      renderForm(onSent);

      const titleInput = screen.getByPlaceholderText(
        /Brief summary/,
      ) as HTMLInputElement;
      const descInput = screen.getByPlaceholderText(
        /Please provide details/,
      ) as HTMLTextAreaElement;

      fireEvent.change(titleInput, { target: { value: 'Bug report' } });
      fireEvent.change(descInput, { target: { value: 'This is a bug' } });

      const submitButton = screen.getByRole('button', { name: /Send report/ });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(
          screen.getByText(
            'You have sent too many reports today. Please try again later.',
          ),
        ).toBeInTheDocument();
      });

      expect(onSent).not.toHaveBeenCalled();
    });

    it('should show generic error message for non-4xx errors', async () => {
      const onSent = jest.fn();
      mockCreateReport.mockRejectedValue({
        response: {
          status: 500,
          data: { message: 'Internal server error' },
        },
      });

      renderForm(onSent);

      const titleInput = screen.getByPlaceholderText(
        /Brief summary/,
      ) as HTMLInputElement;
      const descInput = screen.getByPlaceholderText(
        /Please provide details/,
      ) as HTMLTextAreaElement;

      fireEvent.change(titleInput, { target: { value: 'Bug report' } });
      fireEvent.change(descInput, { target: { value: 'This is a bug' } });

      const submitButton = screen.getByRole('button', { name: /Send report/ });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(
          screen.getByText('Your report could not be sent. Please try again.'),
        ).toBeInTheDocument();
      });

      expect(onSent).not.toHaveBeenCalled();
    });

    it('should show generic error message when 4xx has no message field', async () => {
      const onSent = jest.fn();
      mockCreateReport.mockRejectedValue({
        response: {
          status: 400,
          data: { error: 'Bad request' },
        },
      });

      renderForm(onSent);

      const titleInput = screen.getByPlaceholderText(
        /Brief summary/,
      ) as HTMLInputElement;
      const descInput = screen.getByPlaceholderText(
        /Please provide details/,
      ) as HTMLTextAreaElement;

      fireEvent.change(titleInput, { target: { value: 'Bug report' } });
      fireEvent.change(descInput, { target: { value: 'This is a bug' } });

      const submitButton = screen.getByRole('button', { name: /Send report/ });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(
          screen.getByText('Your report could not be sent. Please try again.'),
        ).toBeInTheDocument();
      });

      expect(onSent).not.toHaveBeenCalled();
    });
  });

  describe('Cancel button', () => {
    it('should call onCancel without submitting', () => {
      const onSent = jest.fn();
      const onCancel = jest.fn();

      renderForm(onSent, onCancel);

      const cancelButton = screen.getByRole('button', { name: /Cancel/ });
      fireEvent.click(cancelButton);

      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(mockCreateReport).not.toHaveBeenCalled();
      expect(onSent).not.toHaveBeenCalled();
    });
  });

  describe('Submission state', () => {
    it('should show "Sending..." text while submitting', async () => {
      mockCreateReport.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve({ id: 'report-123' }), 100);
          }),
      );

      renderForm();

      const titleInput = screen.getByPlaceholderText(
        /Brief summary/,
      ) as HTMLInputElement;
      const descInput = screen.getByPlaceholderText(
        /Please provide details/,
      ) as HTMLTextAreaElement;

      fireEvent.change(titleInput, { target: { value: 'Bug report' } });
      fireEvent.change(descInput, { target: { value: 'This is a bug' } });

      const submitButton = screen.getByRole('button', { name: /Send report/ });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(submitButton).toHaveTextContent('Sending...');
      });

      await waitFor(() => {
        expect(submitButton).toHaveTextContent('Send report');
      });
    });
  });

  describe('Desktop layout', () => {
    it('should show the title counter at 0 / 120 and update it as the title is typed', () => {
      renderForm();

      expect(screen.getByText('0 / 120')).toBeInTheDocument();

      fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), {
        target: { value: 'Hello' },
      });

      expect(screen.getByText('5 / 120')).toBeInTheDocument();
      expect(screen.queryByText('0 / 120')).not.toBeInTheDocument();
    });

    it('should name the Title textbox exactly "Title", without the counter', () => {
      renderForm();

      expect(
        screen.getByRole('textbox', { name: 'Title' }),
      ).toBeInTheDocument();
    });

    it('should render one Send report button in the same row as Cancel', () => {
      renderForm();

      const sendButtons = screen.getAllByRole('button', {
        name: 'Send report',
      });
      expect(sendButtons).toHaveLength(1);

      const cancelButton = screen.getByRole('button', { name: 'Cancel' });
      expect(sendButtons[0].parentElement).toBe(cancelButton.parentElement);
    });
  });
});
