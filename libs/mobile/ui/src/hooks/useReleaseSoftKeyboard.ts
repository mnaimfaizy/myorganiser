import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react';
import { Platform, TextInput, type TextInputInstance } from 'react-native';
import { hideSoftKeyboard } from './hideSoftKeyboard';

/**
 * Closes the soft keyboard once a text input has lost focus to something
 * that takes no text (#1035). Returns the handler for the input's blur.
 *
 * Android leaves the keyboard up when a hardware keyboard's Tab moves focus
 * from a text input to a button, and it stays up over whatever sits at the
 * bottom of the screen — and over the next screen, if the button opened one.
 * `Keyboard.dismiss()` cannot close it: it blurs the input React Native
 * counts as focused, and by then there is none.
 *
 * The check waits until the events behind the blur have all been handled,
 * because an input loses focus before the next one is told it has it. Moving
 * between two text inputs, by Tab or by the keyboard's own "next", therefore
 * leaves the keyboard alone.
 *
 * An input removed before that check has run — by its own blur, or by
 * whatever its blur set off — closes the keyboard as it leaves instead.
 *
 * Touch does not come through here with the keyboard up: a tap on a button
 * leaves focus in the input, and `Keyboard.dismiss()` has hidden the keyboard
 * before the blur it causes arrives.
 */
export function useReleaseSoftKeyboard(
  input: RefObject<TextInputInstance | null>,
): () => void {
  // The input a check is owed for, held from its blur until the check runs.
  const owed = useRef<TextInputInstance | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const release = useCallback(() => {
    const blurred = owed.current;
    owed.current = null;
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    if (blurred !== null && TextInput.State.currentlyFocusedInput() == null) {
      hideSoftKeyboard(blurred);
    }
  }, []);

  // A layout effect, so the command is sent while the view still exists.
  useLayoutEffect(() => release, [release]);

  return useCallback(() => {
    if (Platform.OS !== 'android') return;
    owed.current = input.current;
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(release, 0);
  }, [input, release]);
}
