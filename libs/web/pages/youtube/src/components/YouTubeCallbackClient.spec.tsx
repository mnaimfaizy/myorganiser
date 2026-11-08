/* eslint-disable import/first */
const mockReplace = jest.fn();
const mockSearchParams = { value: new URLSearchParams('code=test-auth-code') };
const mockUseYouTubeAvailability = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => mockSearchParams.value,
}));

jest.mock('../hooks', () => ({
  useYouTubeAvailability: () => mockUseYouTubeAvailability(),
}));

jest.mock('@myorganiser/auth', () => ({
  getAccessToken: jest.fn(),
}));

const mockHandleCallback = jest.fn();
jest.mock('../lib/youtubeApi', () => ({
  createYouTubeApi: () => ({ handleCallback: mockHandleCallback }),
}));

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { getAccessToken } from '@myorganiser/auth';
import { AxiosError, AxiosHeaders } from 'axios';
import YouTubeCallbackClient from './YouTubeCallbackClient';

describe('YouTubeCallbackClient — fail-closed availability', () => {
  const mockGetAccessToken = getAccessToken as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockReplace.mockClear();
    mockSearchParams.value = new URLSearchParams('code=test-auth-code');
    mockHandleCallback.mockReset();
  });

  describe('when available=false', () => {
    beforeEach(() => {
      mockUseYouTubeAvailability.mockReturnValue({
        available: false,
        access: null,
        loading: false,
        error: null,
      });
    });

    it('renders unavailable messaging instead of the loading screen', () => {
      render(<YouTubeCallbackClient />);

      expect(
        screen.getByRole('heading', {
          name: /YouTube is not available right now/i,
        }),
      ).toBeInTheDocument();
      expect(screen.getByText('Please try again later.')).toBeInTheDocument();
      expect(
        screen.queryByText(/Connecting your YouTube account/),
      ).not.toBeInTheDocument();
    });

    it('does not run OAuth exchange side effects', async () => {
      render(<YouTubeCallbackClient />);

      await waitFor(() => {
        expect(mockHandleCallback).not.toHaveBeenCalled();
      });
      expect(mockGetAccessToken).not.toHaveBeenCalled();
      expect(mockReplace).not.toHaveBeenCalledWith('/dashboard/youtube');
    });
  });

  describe('when available=null', () => {
    beforeEach(() => {
      mockUseYouTubeAvailability.mockReturnValue({
        available: null,
        access: null,
        loading: true,
        error: null,
      });
    });

    it('renders fail-closed unavailable state instead of the loading screen', () => {
      render(<YouTubeCallbackClient />);

      expect(
        screen.getByRole('heading', {
          name: /YouTube is not available right now/i,
        }),
      ).toBeInTheDocument();
      expect(screen.getByText('Please try again later.')).toBeInTheDocument();
      expect(
        screen.queryByText(/Connecting your YouTube account/),
      ).not.toBeInTheDocument();
    });

    it('does not run OAuth exchange side effects', async () => {
      render(<YouTubeCallbackClient />);

      await waitFor(() => {
        expect(mockHandleCallback).not.toHaveBeenCalled();
      });
      expect(mockGetAccessToken).not.toHaveBeenCalled();
      expect(mockReplace).not.toHaveBeenCalledWith('/dashboard/youtube');
    });
  });

  describe('unavailable state navigation', () => {
    beforeEach(() => {
      mockUseYouTubeAvailability.mockReturnValue({
        available: false,
        access: null,
        loading: false,
        error: null,
      });
    });

    it('calls router.replace("/dashboard") when Back to Dashboard is clicked', () => {
      render(<YouTubeCallbackClient />);

      fireEvent.click(
        screen.getByRole('button', { name: /Back to Dashboard/i }),
      );

      expect(mockReplace).toHaveBeenCalledWith('/dashboard');
      expect(mockReplace).toHaveBeenCalledTimes(1);
    });
  });

  describe('when available=true', () => {
    beforeEach(() => {
      mockUseYouTubeAvailability.mockReturnValue({
        available: true,
        access: null,
        loading: false,
        error: null,
      });
      mockGetAccessToken.mockReturnValue('token');
    });

    it('exchanges the code through the generated client and routes to YouTube', async () => {
      mockHandleCallback.mockResolvedValue({ data: { ok: true, message: '' } });
      render(<YouTubeCallbackClient />);

      await waitFor(() =>
        expect(mockReplace).toHaveBeenCalledWith('/dashboard/youtube'),
      );
      expect(mockHandleCallback).toHaveBeenCalledWith({
        handleCallbackRequest: { code: 'test-auth-code' },
      });
    });

    it('shows the server message when the exchange reports ok=false', async () => {
      mockHandleCallback.mockResolvedValue({
        data: { ok: false, message: 'Code expired' },
      });
      render(<YouTubeCallbackClient />);

      expect(await screen.findByText('Code expired')).toBeInTheDocument();
      expect(mockReplace).not.toHaveBeenCalledWith('/dashboard/youtube');
    });

    it('shows the error response message when the request is rejected', async () => {
      mockHandleCallback.mockRejectedValue(
        new AxiosError('bad', 'ERR_BAD_REQUEST', undefined, null, {
          status: 400,
          statusText: '',
          headers: {},
          config: { headers: new AxiosHeaders() },
          data: { message: 'Invalid grant' },
        }),
      );
      render(<YouTubeCallbackClient />);

      expect(await screen.findByText('Invalid grant')).toBeInTheDocument();
      expect(mockReplace).not.toHaveBeenCalledWith('/dashboard/youtube');
    });

    it('shows a generic message when the request fails without a response', async () => {
      mockHandleCallback.mockRejectedValue(new Error('network'));
      render(<YouTubeCallbackClient />);

      expect(
        await screen.findByText(
          'Something went wrong while connecting YouTube.',
        ),
      ).toBeInTheDocument();
    });
  });
});
