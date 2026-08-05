import { describe, expect, it, vi } from 'vitest';
import {
  ActiveTabChangedError,
  CaptureSupersededError,
  captureInitiatingTab,
  type CaptureTabDependencies,
} from './capture-session';

const input = {
  tabId: 7,
  windowId: 2,
  normalizedRect: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
  isCurrent: () => true,
};

function makeDeps(): CaptureTabDependencies {
  return {
    getActiveTab: vi.fn(async () => ({ id: 7 })),
    getActivationVersion: vi.fn(() => 0),
    captureVisibleTab: vi.fn(async () => 'data:image/png;base64,FULL'),
    cropImage: vi.fn(async () => 'data:image/png;base64,CROP'),
  };
}

describe('captureInitiatingTab', () => {
  it('verifies the initiating tab immediately before and after capture', async () => {
    const deps = makeDeps();

    await expect(captureInitiatingTab(deps, input)).resolves.toBe(
      'data:image/png;base64,CROP',
    );
    expect(deps.getActiveTab).toHaveBeenCalledTimes(2);
    expect(deps.captureVisibleTab).toHaveBeenCalledWith(2);
    expect(deps.cropImage).toHaveBeenCalledWith(
      'data:image/png;base64,FULL',
      input.normalizedRect,
    );
  });

  it('fails closed if another tab is active before capture', async () => {
    const deps = makeDeps();
    vi.mocked(deps.getActiveTab).mockResolvedValue({ id: 8 });

    await expect(captureInitiatingTab(deps, input)).rejects.toBeInstanceOf(
      ActiveTabChangedError,
    );
    expect(deps.captureVisibleTab).not.toHaveBeenCalled();
  });

  it('rejects the captured pixels if the active tab changes during capture', async () => {
    const deps = makeDeps();
    vi.mocked(deps.getActiveTab)
      .mockResolvedValueOnce({ id: 7 })
      .mockResolvedValueOnce({ id: 8 });

    await expect(captureInitiatingTab(deps, input)).rejects.toBeInstanceOf(
      ActiveTabChangedError,
    );
    expect(deps.cropImage).not.toHaveBeenCalled();
  });

  it('fails closed when the user switches away and back during capture', async () => {
    const deps = makeDeps();
    let version = 0;
    vi.mocked(deps.getActivationVersion).mockImplementation(() => version);
    vi.mocked(deps.captureVisibleTab).mockImplementation(async () => {
      version += 2;
      return 'data:image/png;base64,FULL';
    });

    await expect(captureInitiatingTab(deps, input)).rejects.toBeInstanceOf(
      ActiveTabChangedError,
    );
    expect(deps.cropImage).not.toHaveBeenCalled();
  });

  it('drops a superseded capture without cropping or delivery', async () => {
    const deps = makeDeps();
    let current = true;
    vi.mocked(deps.captureVisibleTab).mockImplementation(async () => {
      current = false;
      return 'data:image/png;base64,FULL';
    });

    await expect(
      captureInitiatingTab(deps, { ...input, isCurrent: () => current }),
    ).rejects.toBeInstanceOf(CaptureSupersededError);
    expect(deps.cropImage).not.toHaveBeenCalled();
  });
});
