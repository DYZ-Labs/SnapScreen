import { describe, expect, it } from 'vitest';
import { stripMarkdown } from './plain-text';

describe('stripMarkdown', () => {
  it('strips heading markers', () => {
    expect(stripMarkdown('## Answer')).toBe('Answer');
  });

  it('strips bullet list markers', () => {
    expect(stripMarkdown('- first\n* second\n+ third')).toBe('first\nsecond\nthird');
  });

  it('strips ordered list markers', () => {
    expect(stripMarkdown('1. first\n2. second')).toBe('first\nsecond');
  });

  it('unwraps bold and underscore emphasis', () => {
    expect(stripMarkdown('**bold** and __also bold__')).toBe('bold and also bold');
  });

  it('unwraps inline code and removes stray backticks', () => {
    expect(stripMarkdown('use `map()` here')).toBe('use map() here');
    expect(stripMarkdown('```\ncode line\n```')).toBe('code line');
  });

  it('collapses runs of blank lines to a single blank line', () => {
    expect(stripMarkdown('a\n\n\n\nb')).toBe('a\n\nb');
  });

  it('trims surrounding whitespace', () => {
    expect(stripMarkdown('  answer  \n')).toBe('answer');
  });

  it('leaves plain text untouched', () => {
    expect(stripMarkdown('2 + 2 = 4')).toBe('2 + 2 = 4');
  });
});
