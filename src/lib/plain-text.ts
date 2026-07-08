export function stripMarkdown(text: string): string {
  const lines = text.split('\n').map((line) => {
    let stripped = line.replace(/^#{1,6}\s+/, '');
    stripped = stripped.replace(/^\s*[-*+]\s+/, '');
    stripped = stripped.replace(/^\s*\d+\.\s+/, '');
    return stripped;
  });

  let result = lines.join('\n');

  result = result.replace(/\*\*([^*]+)\*\*/g, '$1');
  result = result.replace(/__([^_]+)__/g, '$1');
  result = result.replace(/`([^`]+)`/g, '$1');
  result = result.replace(/`/g, '');
  result = result.replace(/\n{3,}/g, '\n\n');

  return result.trim();
}
