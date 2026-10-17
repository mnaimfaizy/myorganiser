/* eslint-disable import/first */
jest.mock('./FeedbackReportForm', () => ({
  FeedbackReportForm: jest.fn(({ onSent, onCancel }) => (
    <div data-testid="feedback-report-form">
      <button onClick={onSent}>Form Send</button>
      <button onClick={onCancel}>Form Cancel</button>
    </div>
  )),
}));

import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import {
  openFeedbackDialog,
  setFeedbackDialogOpen,
} from '../hooks/use-feedback-dialog';
import { FeedbackDialog } from './FeedbackDialog';

describe('FeedbackDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
});
