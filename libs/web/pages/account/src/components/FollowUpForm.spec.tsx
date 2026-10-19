/* eslint-disable import/first */
jest.mock('../lib/apiClient', () => ({
  createFeedbackApi: jest.fn(),
}));

jest.mock('@myorganiser/web-ui', () => ({
  ...jest.requireActual('@myorganiser/web-ui'),
  useToast: jest.fn(),
}));

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { useToast } from '@myorganiser/web-ui';
import { createFeedbackApi } from '../lib/apiClient';
import { FollowUpForm } from './FollowUpForm';

const mockAddFollowUp = jest.fn();
const mockToast = jest.fn();

function setupMocks() {
  (useToast as jest.Mock).mockReturnValue({ toast: mockToast });
  (createFeedbackApi as jest.Mock).mockReturnValue({
    addFollowUp: mockAddFollowUp,
  });
}

function renderForm(onSent = jest.fn()) {
  return render(<FollowUpForm reportId="report-1" onSent={onSent} />);
}

describe('FollowUpForm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupMocks();
  });

  it('should render the follow-up field and submit button', () => {
    renderForm();

    expect(screen.getByLabelText(/Follow-up/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Send follow-up/ }),
    ).toBeInTheDocument();
  });

  it('should show required error on empty submit', async () => {
    const onSent = jest.fn();
    renderForm(onSent);

    const submitButton = screen.getByRole('button', { name: /Send follow-up/ });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText('Enter a follow-up.')).toBeInTheDocument();
    });

    expect(mockAddFollowUp).not.toHaveBeenCalled();
    expect(onSent).not.toHaveBeenCalled();
  });

  it('should show cap error when exceeding 2000 characters', async () => {
    const onSent = jest.fn();
    renderForm(onSent);

    const textarea = screen.getByLabelText(/Follow-up/) as HTMLTextAreaElement;
    const longText = 'a'.repeat(2001);
    fireEvent.change(textarea, { target: { value: longText } });

    const submitButton = screen.getByRole('button', { name: /Send follow-up/ });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(
        screen.getByText('Your follow-up must be 2,000 characters or fewer.'),
      ).toBeInTheDocument();
    });

    expect(mockAddFollowUp).not.toHaveBeenCalled();
    expect(onSent).not.toHaveBeenCalled();
  });

  it('should call addFollowUp and onSent on successful submission', async () => {
    const onSent = jest.fn();
    const responseData = {
      id: 'report-1',
      status: 'under_review',
      followUp: 'More detail about the bug',
      title: 'Bug Title',
      description: 'Bug Description',
      kind: 'bug_report' as const,
      createdAt: '2026-10-18T00:00:00Z',
      updatedAt: '2026-10-18T00:00:00Z',
    };
    mockAddFollowUp.mockResolvedValue({ data: responseData });

    renderForm(onSent);

    const textarea = screen.getByLabelText(/Follow-up/) as HTMLTextAreaElement;
    fireEvent.change(textarea, {
      target: { value: 'More detail about the bug' },
    });

    const submitButton = screen.getByRole('button', { name: /Send follow-up/ });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(mockAddFollowUp).toHaveBeenCalledTimes(1);
    });

    expect(mockAddFollowUp).toHaveBeenCalledWith({
      reportId: 'report-1',
      addFollowUpRequest: { followUp: 'More detail about the bug' },
    });

    await waitFor(() => {
      expect(onSent).toHaveBeenCalledWith(responseData);
    });
  });

  it('should show success toast on successful submission', async () => {
    const responseData = {
      id: 'report-1',
      status: 'under_review',
      followUp: 'More detail',
      title: 'Bug Title',
      description: 'Bug Description',
      kind: 'bug_report' as const,
      createdAt: '2026-10-18T00:00:00Z',
      updatedAt: '2026-10-18T00:00:00Z',
    };
    mockAddFollowUp.mockResolvedValue({ data: responseData });

    renderForm();

    const textarea = screen.getByLabelText(/Follow-up/) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'More detail' } });

    const submitButton = screen.getByRole('button', { name: /Send follow-up/ });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledTimes(1);
    });

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Follow-up sent',
      }),
    );
  });

  it('should show "Sending..." text while submitting', async () => {
    mockAddFollowUp.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve({
                data: {
                  id: 'report-1',
                  status: 'under_review',
                  followUp: 'More detail',
                  title: 'Bug Title',
                  description: 'Bug Description',
                  kind: 'bug_report' as const,
                  createdAt: '2026-10-18T00:00:00Z',
                  updatedAt: '2026-10-18T00:00:00Z',
                },
              }),
            100,
          );
        }),
    );

    renderForm();

    const textarea = screen.getByLabelText(/Follow-up/) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'More detail' } });

    const submitButton = screen.getByRole('button', { name: /Send follow-up/ });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(submitButton).toHaveTextContent('Sending...');
    });

    await waitFor(() => {
      expect(submitButton).toHaveTextContent('Send follow-up');
    });
  });

  it('should show 4xx server error message on rejection', async () => {
    const onSent = jest.fn();
    mockAddFollowUp.mockRejectedValue({
      isAxiosError: true,
      config: {},
      response: {
        status: 400,
        data: {
          message: 'You have already sent a Follow-up on that report.',
        },
      },
    });

    renderForm(onSent);

    const textarea = screen.getByLabelText(/Follow-up/) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'More detail' } });

    const submitButton = screen.getByRole('button', { name: /Send follow-up/ });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(
        screen.getByText('You have already sent a Follow-up on that report.'),
      ).toBeInTheDocument();
    });

    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(onSent).not.toHaveBeenCalled();
  });

  it('should show generic error message for non-4xx errors', async () => {
    const onSent = jest.fn();
    mockAddFollowUp.mockRejectedValue({
      response: {
        status: 500,
        data: { error: 'boom' },
      },
    });

    renderForm(onSent);

    const textarea = screen.getByLabelText(/Follow-up/) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'More detail' } });

    const submitButton = screen.getByRole('button', { name: /Send follow-up/ });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(
        screen.getByText('Your follow-up could not be sent. Please try again.'),
      ).toBeInTheDocument();
    });

    expect(onSent).not.toHaveBeenCalled();
  });
});
