import { describe, expect, it } from 'vitest';
import { getComposerButtonState } from './composer-button-state';

describe('getComposerButtonState', () => {
  it('enables stop mode while generation is pending', () => {
    expect(
      getComposerButtonState({
        pending: true,
        hasText: false,
        isFatalError: false,
        canStop: true,
      }),
    ).toEqual({
      mode: 'stop',
      ariaLabel: 'Stop generating',
      disabled: false,
      active: true,
    });
  });

  it('disables stop mode when no stop handler is available', () => {
    expect(
      getComposerButtonState({
        pending: true,
        hasText: true,
        isFatalError: false,
        canStop: false,
      }),
    ).toMatchObject({
      mode: 'stop',
      disabled: true,
      active: false,
    });
  });

  it('enables send mode when idle with text', () => {
    expect(
      getComposerButtonState({
        pending: false,
        hasText: true,
        isFatalError: false,
        canStop: true,
      }),
    ).toEqual({
      mode: 'send',
      ariaLabel: 'Send message',
      disabled: false,
      active: true,
    });
  });

  it('disables send mode when idle with no text', () => {
    expect(
      getComposerButtonState({
        pending: false,
        hasText: false,
        isFatalError: false,
        canStop: true,
      }),
    ).toMatchObject({
      mode: 'send',
      disabled: true,
      active: false,
    });
  });

  it('disables send mode for fatal errors', () => {
    expect(
      getComposerButtonState({
        pending: false,
        hasText: true,
        isFatalError: true,
        canStop: true,
      }),
    ).toMatchObject({
      mode: 'send',
      disabled: true,
      active: false,
    });
  });
});
