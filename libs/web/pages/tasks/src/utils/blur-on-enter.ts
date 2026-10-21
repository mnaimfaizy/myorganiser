import type { KeyboardEvent } from 'react';

/**
 * Enter on a single-line detail field commits it by blurring the field. The
 * blur handler is the one commit path, so Enter and a click-away cannot save
 * twice.
 */
export function blurOnEnter(event: KeyboardEvent<HTMLInputElement>): void {
  if (event.key === 'Enter') {
    event.preventDefault();
    event.currentTarget.blur();
  }
}
