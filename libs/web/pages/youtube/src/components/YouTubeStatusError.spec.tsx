import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { YouTubeStatusError } from './YouTubeStatusError';

describe('YouTubeStatusError', () => {
  it('announces the connection-check failure as an alert', () => {
    render(<YouTubeStatusError onRetry={jest.fn()} />);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Could not check your YouTube connection.',
    );
  });

  it('calls onRetry once when Retry is pressed', () => {
    const onRetry = jest.fn();
    render(<YouTubeStatusError onRetry={onRetry} />);

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
