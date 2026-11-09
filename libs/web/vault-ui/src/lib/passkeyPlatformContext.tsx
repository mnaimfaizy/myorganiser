'use client';

import { createContext, useContext, type ReactNode } from 'react';

import {
  createBrowserPasskeyPlatform,
  type PasskeyPlatform,
} from '@myorganiser/web-vault';

/**
 * The WebAuthn Platform Adapter Passkey Unlock surfaces use. App code mounts
 * nothing and gets the browser's `navigator.credentials`; a test or a story
 * mounts `PasskeyPlatformProvider` with a fake authenticator.
 */
const PasskeyPlatformContext = createContext<PasskeyPlatform | null>(null);

let browserPasskeyPlatform: PasskeyPlatform | null = null;

export interface PasskeyPlatformProviderProps {
  platform: PasskeyPlatform;
  children: ReactNode;
}

export function PasskeyPlatformProvider(props: PasskeyPlatformProviderProps) {
  return (
    <PasskeyPlatformContext.Provider value={props.platform}>
      {props.children}
    </PasskeyPlatformContext.Provider>
  );
}

export function usePasskeyPlatform(): PasskeyPlatform {
  const platform = useContext(PasskeyPlatformContext);
  if (platform) return platform;
  browserPasskeyPlatform ??= createBrowserPasskeyPlatform();
  return browserPasskeyPlatform;
}
