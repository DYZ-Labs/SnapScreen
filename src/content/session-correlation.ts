export interface GenerationIdentity {
  captureId: string;
  requestId: string;
  screenshotId: string;
}

export function matchesActiveGeneration(
  panelOpen: boolean,
  active: GenerationIdentity | null,
  incoming: GenerationIdentity,
): boolean {
  return panelOpen
    && active !== null
    && active.captureId === incoming.captureId
    && active.requestId === incoming.requestId
    && active.screenshotId === incoming.screenshotId;
}

export function matchesPendingCapture(
  activeCaptureId: string | null,
  capturePending: boolean,
  incomingCaptureId: string,
): boolean {
  return capturePending && activeCaptureId === incomingCaptureId;
}
