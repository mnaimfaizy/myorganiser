'use client';

import { useSyncExternalStore } from 'react';

// The dialog is mounted once in the dashboard layout and both the sidebar
// footer and the user menu open it, so the open state lives in a module-level
// store rather than a context or per-component useState.

let feedbackDialogOpen = false;
const listeners: Array<() => void> = [];

function subscribe(listener: () => void) {
  listeners.push(listener);
  return () => {
    const index = listeners.indexOf(listener);
    if (index > -1) {
      listeners.splice(index, 1);
    }
  };
}

function getSnapshot(): boolean {
  return feedbackDialogOpen;
}

/**
 * Set the feedback dialog open/closed state.
 *
 * @param open - whether the dialog should be open
 */
export function setFeedbackDialogOpen(open: boolean): void {
  feedbackDialogOpen = open;
  for (const listener of listeners.slice()) {
    listener();
  }
}

/**
 * Open the feedback dialog.
 */
export function openFeedbackDialog(): void {
  setFeedbackDialogOpen(true);
}

/**
 * Subscribe to changes in the feedback dialog open state.
 * Returns true if the dialog is open, false otherwise.
 *
 * This uses React's useSyncExternalStore for subscription.
 */
export function useFeedbackDialogOpen(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
