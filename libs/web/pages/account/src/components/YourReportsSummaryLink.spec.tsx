/* eslint-disable import/first */
jest.mock('../lib/apiClient', () => ({
  createFeedbackApi: jest.fn(),
}));

import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { createFeedbackApi } from '../lib/apiClient';
import { YourReportsSummaryLink } from './YourReportsSummaryLink';

const mockListReports = jest.fn();

function setupMocks() {
  (createFeedbackApi as jest.Mock).mockReturnValue({
    listReports: mockListReports,
  });
}

describe('YourReportsSummaryLink', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    (console.error as jest.Mock).mockRestore();
  });

  it('should always render title and link to reports page', async () => {
    mockListReports.mockResolvedValue({
      data: { items: [], hasChangedSinceLastSeen: false },
    });

    render(<YourReportsSummaryLink />);

    expect(screen.getByText('Your reports')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /View your reports/ });
    expect(link).toHaveAttribute('href', '/dashboard/account/reports');
  });

  it('should not show Updated badge before fetch resolves', () => {
    mockListReports.mockImplementation(
      () => new Promise(() => {}), // Never resolves
    );

    render(<YourReportsSummaryLink />);

    expect(screen.queryByText('Updated')).not.toBeInTheDocument();
  });

  it('should show Updated badge when hasChangedSinceLastSeen is true', async () => {
    mockListReports.mockResolvedValue({
      data: { items: [], hasChangedSinceLastSeen: true },
    });

    render(<YourReportsSummaryLink />);

    await waitFor(() => {
      expect(screen.getByText('Updated')).toBeInTheDocument();
    });
  });

  it('should not show badge when hasChangedSinceLastSeen is false', async () => {
    mockListReports.mockResolvedValue({
      data: { items: [], hasChangedSinceLastSeen: false },
    });

    render(<YourReportsSummaryLink />);

    await waitFor(() => {
      expect(screen.getByText('View your reports →')).toBeInTheDocument();
    });

    expect(screen.queryByText('Updated')).not.toBeInTheDocument();
  });

  it('should show no badge and log error when fetch fails', async () => {
    mockListReports.mockRejectedValue(new Error('Network error'));

    render(<YourReportsSummaryLink />);

    await waitFor(() => {
      expect(console.error).toHaveBeenCalledWith(
        'Failed to fetch reports summary',
      );
    });

    // Link should still be present
    const link = screen.getByRole('link', { name: /View your reports/ });
    expect(link).toHaveAttribute('href', '/dashboard/account/reports');

    // No badge should be visible
    expect(screen.queryByText('Updated')).not.toBeInTheDocument();
  });
});
