export type ComposerButtonMode = 'send' | 'stop';

export interface ComposerButtonStateInput {
  pending: boolean;
  hasText: boolean;
  isFatalError: boolean;
  canStop: boolean;
}

export interface ComposerButtonState {
  mode: ComposerButtonMode;
  ariaLabel: string;
  disabled: boolean;
  active: boolean;
}

export function getComposerButtonState(
  input: ComposerButtonStateInput,
): ComposerButtonState {
  if (input.pending) {
    return {
      mode: 'stop',
      ariaLabel: 'Stop generating',
      disabled: !input.canStop,
      active: input.canStop,
    };
  }

  const canSend = !input.isFatalError && input.hasText;
  return {
    mode: 'send',
    ariaLabel: 'Send message',
    disabled: !canSend,
    active: canSend,
  };
}
