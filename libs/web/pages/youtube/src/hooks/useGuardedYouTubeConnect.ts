'use client';

import { useCallback, useState } from 'react';
import { useYouTubeConnect } from './index';

/**
 * Wraps `useYouTubeConnect().connect` so a rejected auth-url request does not
 * escape as an unhandled rejection: the User stays on the prompt, sees why via
 * `connectError`, and can press Connect again (which clears the message).
 */
export function useGuardedYouTubeConnect() {
  const { connect } = useYouTubeConnect();
  const [connectError, setConnectError] = useState<string | null>(null);

  const handleConnect = useCallback(async () => {
    setConnectError(null);
    try {
      await connect();
    } catch {
      setConnectError(
        'Could not start the YouTube connection. Please try again.',
      );
    }
  }, [connect]);

  return { handleConnect, connectError };
}
