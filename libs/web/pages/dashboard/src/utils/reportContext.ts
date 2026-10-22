/**
 * Report Context detection — the environment data sent with a Feedback Report.
 * Pure functions for testability; nothing React or Node-specific here.
 */

import type { FeedbackReportPlatform } from '@myorganiser/app-api-client';

export interface ReportContext {
  platform: FeedbackReportPlatform;
  appVersion: string;
  browser: string;
  operatingSystem: string;
  path: string;
  sentAt: string;
}

/**
 * Recognise the browser from the user-agent string.
 * Tests Edge/Opera before Chrome (both claim Chromium), and Chrome before Safari.
 */
function detectBrowser(userAgent: string): string {
  // Edge includes "Edg/" and must be tested before Chrome
  if (userAgent.includes('Edg/')) {
    const match = userAgent.match(/Edg\/(\d+)/);
    if (match) return `Edge ${match[1]}`;
    return 'Edge';
  }

  // Opera includes "OPR/" and must be tested before Chrome
  if (userAgent.includes('OPR/')) {
    const match = userAgent.match(/OPR\/(\d+)/);
    if (match) return `Opera ${match[1]}`;
    return 'Opera';
  }

  // Chrome
  if (userAgent.includes('Chrome/')) {
    const match = userAgent.match(/Chrome\/(\d+)/);
    if (match) return `Chrome ${match[1]}`;
    return 'Chrome';
  }

  // Firefox
  if (userAgent.includes('Firefox/')) {
    const match = userAgent.match(/Firefox\/(\d+)/);
    if (match) return `Firefox ${match[1]}`;
    return 'Firefox';
  }

  // Safari must come last (other browsers claim Safari compatibility)
  if (userAgent.includes('Safari/')) {
    const match = userAgent.match(/Version\/(\d+)/);
    if (match) return `Safari ${match[1]}`;
    return 'Safari';
  }

  return 'Unknown browser';
}

/**
 * Recognise the operating system from the user-agent string.
 */
function detectOperatingSystem(userAgent: string): string {
  if (userAgent.includes('Windows')) {
    return 'Windows';
  }
  // Test iOS before macOS: an iPhone or iPad user-agent reads
  // "(iPhone; CPU iPhone OS 17_6 like Mac OS X)", so a macOS test placed first
  // claims every iOS device as a Mac.
  if (
    userAgent.includes('iPhone') ||
    userAgent.includes('iPad') ||
    userAgent.includes('iPod')
  ) {
    return 'iOS';
  }
  if (userAgent.includes('Macintosh') || userAgent.includes('Mac OS X')) {
    return 'macOS';
  }
  if (userAgent.includes('Android')) {
    return 'Android';
  }
  // Test CrOS before Linux (Chrome OS user-agents do not contain "Linux").
  if (userAgent.includes('CrOS')) {
    return 'ChromeOS';
  }
  if (userAgent.includes('Linux')) {
    return 'Linux';
  }
  return 'Unknown operating system';
}

/**
 * Strip query string and fragment from a pathname.
 */
function stripQueryAndFragment(pathname: string): string {
  const questionMarkIndex = pathname.indexOf('?');
  const hashIndex = pathname.indexOf('#');
  let endIndex = pathname.length;

  if (questionMarkIndex !== -1) {
    endIndex = Math.min(endIndex, questionMarkIndex);
  }
  if (hashIndex !== -1) {
    endIndex = Math.min(endIndex, hashIndex);
  }

  return pathname.slice(0, endIndex);
}

/**
 * Pure: returns everything the Report Context says from values handed in.
 */
export function describeReportContext(input: {
  userAgent: string;
  pathname: string;
  appVersion: string;
  sentAt: Date;
}): ReportContext {
  return {
    platform: 'web',
    appVersion: input.appVersion,
    browser: detectBrowser(input.userAgent),
    operatingSystem: detectOperatingSystem(input.userAgent),
    path: stripQueryAndFragment(input.pathname),
    sentAt: input.sentAt.toISOString(),
  };
}

/**
 * Reads the browser's own values for Report Context.
 * Safe to call during render on the client.
 */
export function readReportContext(
  pathname: string,
  sentAt?: Date,
): ReportContext {
  const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const appVersion = process.env.NEXT_PUBLIC_APP_VERSION || 'unknown';

  return describeReportContext({
    userAgent,
    pathname,
    appVersion,
    sentAt: sentAt || new Date(),
  });
}
