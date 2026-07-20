import type { SnapScreenLimits, SnapScreenSessionSettings } from './storage';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | {
      type: 'image';
      source: { type: 'base64'; media_type: 'image/png'; data: string };
    };

export type AnthropicMessage = {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
};

export type DisplayMessage = {
  role: 'user' | 'assistant';
  content: string;
  status?: 'failed';
};

export type BgToCsMessage =
  | {
      type: 'START_SNIP';
      hasApiKey: boolean;
      defaultPrompt: string;
      limits: SnapScreenLimits;
    }
  | { type: 'CROPPED_IMAGE'; dataUrl: string; captureId: string }
  | { type: 'CAPTURE_ERROR'; code: string; message: string; captureId: string }
  | {
      type: 'ANALYZE_CHUNK';
      text: string;
      captureId: string;
      requestId: string;
      screenshotId: string;
    }
  | {
      type: 'ANALYZE_RESULT';
      text: string;
      captureId: string;
      requestId: string;
      screenshotId: string;
      history?: AnthropicMessage[];
    }
  | {
      type: 'ANALYZE_ERROR';
      code: string;
      message: string;
      captureId: string;
      requestId: string;
      screenshotId: string;
    }
  | { type: 'SHOW_ERROR'; message: string };

export type CsToBgMessage =
  | { type: 'CAPTURE_REGION'; rect: Rect; devicePixelRatio: number; captureId: string }
  | {
      type: 'ANALYZE';
      dataUrl: string;
      captureId: string;
      requestId: string;
      screenshotId: string;
      sessionSettings: SnapScreenSessionSettings;
      question?: string;
    }
  | {
      type: 'FOLLOW_UP';
      text: string;
      history: AnthropicMessage[];
      captureId: string;
      requestId: string;
      screenshotId: string;
      sessionSettings: SnapScreenSessionSettings;
    }
  | { type: 'CANCEL_GENERATION'; captureId: string; requestId: string }
  | { type: 'SNIP_CANCELLED'; captureId: string }
  | { type: 'UI_UNAVAILABLE' };

export type RuntimeMessage = BgToCsMessage | CsToBgMessage;
