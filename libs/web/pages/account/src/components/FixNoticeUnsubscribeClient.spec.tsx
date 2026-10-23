/* eslint-disable import/first */
const mockSearchParams = { value: new URLSearchParams() };

jest.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams.value,
}));

jest.mock('@myorganiser/core', () => ({
  getApiBaseUrl: jest.fn(),
}));

import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { getApiBaseUrl } from '@myorganiser/core';
import FixNoticeUnsubscribeClient from './FixNoticeUnsubscribeClient';

describe('FixNoticeUnsubscribeClient', () => {
  const mockFetch = jest.fn<
    Promise<Response>,
    [RequestInfo | URL, RequestInit?]
  >();

  beforeEach(() => {
    jest.clearAllMocks();
    mockSearchParams.value = new URLSearchParams();
    mockFetch.mockReset();
    global.fetch = mockFetch as unknown as typeof fetch;
    (getApiBaseUrl as jest.Mock).mockReturnValue('http://api.example.com');
  });

  it('should render invalid-link state immediately when no token in URL', () => {
    mockSearchParams.value = new URLSearchParams();

    render(<FixNoticeUnsubscribeClient />);

    expect(screen.getByRole('status', { hidden: false })).toBeInTheDocument();
    expect(screen.getByText('Link no longer valid')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /Go to account settings/ }),
    ).toBeInTheDocument();

    // Verify fetch was never called
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should link the MyOrganiser logo to the home page when no token is present', () => {
    mockSearchParams.value = new URLSearchParams();

    render(<FixNoticeUnsubscribeClient />);

    expect(
      screen.getByRole('link', { name: 'MyOrganiser home' }),
    ).toHaveAttribute('href', '/');
  });

  it('should show invalid-link state when token is only whitespace', () => {
    mockSearchParams.value = new URLSearchParams('token=   ');

    render(<FixNoticeUnsubscribeClient />);

    expect(screen.getByText('Link no longer valid')).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should transition from working to done when fetch resolves successfully', async () => {
    mockSearchParams.value = new URLSearchParams('token=valid-token-123');
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    } as Response);

    render(<FixNoticeUnsubscribeClient />);

    // Wait for the done state
    await waitFor(() => {
      expect(screen.getByText('Fix Notices turned off')).toBeInTheDocument();
    });

    // Verify the success message and link are shown
    expect(
      screen.getByText(
        /You will no longer receive an email when one of your Feedback/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /Go to your reports/ }),
    ).toHaveAttribute('href', '/dashboard/account/reports');
  });

  it('should show invalid-link state when fetch returns 404', async () => {
    mockSearchParams.value = new URLSearchParams('token=expired-token');
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
    } as Response);

    render(<FixNoticeUnsubscribeClient />);

    await waitFor(() => {
      expect(screen.getByText('Link no longer valid')).toBeInTheDocument();
    });

    expect(
      screen.getByRole('link', { name: /Go to account settings/ }),
    ).toBeInTheDocument();
  });

  it('should show error state when fetch returns non-ok non-404 status', async () => {
    mockSearchParams.value = new URLSearchParams('token=valid-token');
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
    } as Response);

    render(<FixNoticeUnsubscribeClient />);

    await waitFor(() => {
      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    });

    expect(
      screen.getByRole('button', { name: /Try again/ }),
    ).toBeInTheDocument();
  });

  it('should show error state when fetch rejects with network error', async () => {
    mockSearchParams.value = new URLSearchParams('token=valid-token');
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    render(<FixNoticeUnsubscribeClient />);

    await waitFor(() => {
      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    });

    expect(
      screen.getByRole('button', { name: /Try again/ }),
    ).toBeInTheDocument();
  });

  it('should re-invoke fetch when retry button is clicked', async () => {
    mockSearchParams.value = new URLSearchParams('token=valid-token');

    let callCount = 0;
    mockFetch.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error('Network error');
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      } as Response;
    });

    render(<FixNoticeUnsubscribeClient />);

    await waitFor(() => {
      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);

    const retryButton = screen.getByRole('button', { name: /Try again/ });
    fireEvent.click(retryButton);

    await waitFor(() => {
      expect(screen.getByText('Fix Notices turned off')).toBeInTheDocument();
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('should call fetch with correct POST request shape', async () => {
    mockSearchParams.value = new URLSearchParams('token=my-token-xyz');
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    } as Response);

    render(<FixNoticeUnsubscribeClient />);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://api.example.com/feedback/fix-notice/unsubscribe',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ token: 'my-token-xyz' }),
      },
    );
  });

  it('should show error state when response ok is false in JSON body', async () => {
    mockSearchParams.value = new URLSearchParams('token=valid-token');
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ok: false }),
    } as Response);

    render(<FixNoticeUnsubscribeClient />);

    await waitFor(() => {
      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    });
  });

  it('should offer Try again and a link to your reports in the error state', async () => {
    mockSearchParams.value = new URLSearchParams('token=valid-token');
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
    } as Response);

    render(<FixNoticeUnsubscribeClient />);

    await waitFor(() => {
      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    });

    expect(
      screen.getByRole('button', { name: /Try again/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /Go to your reports/ }),
    ).toHaveAttribute('href', '/dashboard/account/reports');
  });
});
