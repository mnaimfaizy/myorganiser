/* eslint-disable import/first */
const mockSearchParams = { value: new URLSearchParams('token=abc') };
const mockUnsubscribe = jest.fn();

jest.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams.value,
}));
jest.mock('../lib/youtubeApi', () => ({
  createAnonymousYouTubeApi: () => ({ unsubscribeFromDigest: mockUnsubscribe }),
}));

import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import { AxiosError, AxiosHeaders } from 'axios';
import YouTubeUnsubscribeClient from './YouTubeUnsubscribeClient';

function responseError(status: number) {
  return new AxiosError('failed', 'ERR_BAD_REQUEST', undefined, null, {
    status,
    statusText: '',
    headers: {},
    config: { headers: new AxiosHeaders() },
    data: {},
  });
}

describe('YouTubeUnsubscribeClient', () => {
  beforeEach(() => {
    mockUnsubscribe.mockReset();
    mockSearchParams.value = new URLSearchParams('token=abc');
  });

  it('unsubscribes through the generated client and confirms', async () => {
    mockUnsubscribe.mockResolvedValue({ data: { ok: true, message: '' } });
    render(<YouTubeUnsubscribeClient />);

    expect(await screen.findByText('Digest turned off')).toBeInTheDocument();
    expect(mockUnsubscribe).toHaveBeenCalledWith({
      unsubscribeBody: { token: 'abc' },
    });
  });

  it('treats ok=false as a failure', async () => {
    mockUnsubscribe.mockResolvedValue({ data: { ok: false, message: '' } });
    render(<YouTubeUnsubscribeClient />);

    expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
  });

  it('treats a 404 response as an invalid link', async () => {
    mockUnsubscribe.mockRejectedValue(responseError(404));
    render(<YouTubeUnsubscribeClient />);

    expect(await screen.findByText('Link no longer valid')).toBeInTheDocument();
  });

  it('treats any other error response as a failure', async () => {
    mockUnsubscribe.mockRejectedValue(responseError(500));
    render(<YouTubeUnsubscribeClient />);

    expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
  });

  it('does not call the API without a token', async () => {
    mockSearchParams.value = new URLSearchParams('');
    render(<YouTubeUnsubscribeClient />);

    expect(screen.getByText('Link no longer valid')).toBeInTheDocument();
    await waitFor(() => expect(mockUnsubscribe).not.toHaveBeenCalled());
  });
});
