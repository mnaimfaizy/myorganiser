import type { TextInputInstance } from 'react-native';

/**
 * The soft-keyboard Platform Variant for the `react-native-web` target.
 *
 * A browser has no soft keyboard to send a command to, and `react-native-web`
 * has no `codegenNativeCommands` to send one with, so this is a no-op.
 * `useReleaseSoftKeyboard` only calls it on Android in any case.
 */
export function hideSoftKeyboard(_input: TextInputInstance): void {
  return undefined;
}
