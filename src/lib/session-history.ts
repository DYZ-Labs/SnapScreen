import { dataUrlToBase64 } from './crop';
import type { AnthropicContentBlock, AnthropicMessage } from './messages';

export const SESSION_GUIDANCE_PREFIX = 'Screenshot task guidance:\n';

export function createSessionGuidanceBlock(instruction: string): AnthropicContentBlock {
  return {
    type: 'text',
    text: `${SESSION_GUIDANCE_PREFIX}${instruction}`,
  };
}

export function createScreenshotUserContent(
  dataUrl: string,
  instruction?: string,
  question?: string,
): AnthropicContentBlock[] {
  const content: AnthropicContentBlock[] = [
    {
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: dataUrlToBase64(dataUrl),
      },
    },
  ];

  const cleanInstruction = instruction?.trim();
  if (cleanInstruction) content.push(createSessionGuidanceBlock(cleanInstruction));
  const cleanQuestion = question?.trim();
  if (cleanQuestion) content.push({ type: 'text', text: cleanQuestion });
  return content;
}

export function retainSessionGuidance(
  history: AnthropicMessage[],
  instruction?: string,
): AnthropicMessage[] {
  const trimmed = instruction?.trim();
  if (!trimmed) return history;

  const imageTurnIndex = history.findIndex((message) =>
    message.role === 'user'
      && Array.isArray(message.content)
      && message.content.some((block) => block.type === 'image'),
  );
  if (imageTurnIndex === -1) return history;

  const imageTurn = history[imageTurnIndex];
  if (!Array.isArray(imageTurn.content)) return history;
  if (
    imageTurn.content.some(
      (block) => block.type === 'text' && block.text.startsWith(SESSION_GUIDANCE_PREFIX),
    )
  ) {
    return history;
  }

  const content = [...imageTurn.content];
  const imageIndex = content.findIndex((block) => block.type === 'image');
  content.splice(imageIndex + 1, 0, createSessionGuidanceBlock(trimmed));

  const enriched = [...history];
  enriched[imageTurnIndex] = { ...imageTurn, content };
  return enriched;
}
