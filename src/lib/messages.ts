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
};

export type BgToCsMessage =
  | { type: 'START_SNIP'; hasApiKey: boolean }
  | { type: 'CROPPED_IMAGE'; dataUrl: string }
  | { type: 'ANALYZE_CHUNK'; text: string; screenshotId: string }
  | {
      type: 'ANALYZE_RESULT';
      text: string;
      screenshotId: string;
      history?: AnthropicMessage[];
      prompt?: string;
    }
  | { type: 'ANALYZE_ERROR'; code: string; message: string; screenshotId: string }
  | { type: 'SHOW_ERROR'; message: string };

export type CsToBgMessage =
  | { type: 'CAPTURE_REGION'; rect: Rect; devicePixelRatio: number }
  | { type: 'ANALYZE'; dataUrl: string; screenshotId: string; prompt?: string }
  | { type: 'FOLLOW_UP'; text: string; history: AnthropicMessage[]; screenshotId: string }
  | { type: 'CANCEL_GENERATION' }
  | { type: 'SNIP_CANCELLED' };

export type RuntimeMessage = BgToCsMessage | CsToBgMessage;
