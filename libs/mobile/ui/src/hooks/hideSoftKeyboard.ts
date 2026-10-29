import { codegenNativeCommands, type TextInputInstance } from 'react-native';

interface InputCommands {
  blur: (input: TextInputInstance) => void;
}

let commands: InputCommands | null = null;

/**
 * Sends Android's text input its `blur` command, which hides the soft
 * keyboard whether or not the input still holds focus. Made on first use.
 *
 * `hideSoftKeyboard.web.ts` stands in for this on the web target:
 * `react-native-web` has no `codegenNativeCommands`, and the import alone
 * fails that build's link step.
 */
export function hideSoftKeyboard(input: TextInputInstance): void {
  commands ??= codegenNativeCommands<InputCommands>({
    supportedCommands: ['blur'],
  });
  commands.blur(input);
}
