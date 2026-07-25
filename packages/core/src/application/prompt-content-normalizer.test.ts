import { describe, expect, it } from 'vitest';
import { normalizePromptContextContent } from './prompt-content-normalizer';

describe('normalizePromptContextContent', () => {
  it('removes CSI sequences introduced by ESC or C1 CSI', () => {
    expect(normalizePromptContextContent('before\x1B[Kafter')).toBe('beforeafter');
    expect(normalizePromptContextContent('\x1B[31mred\x1B[0m')).toBe('red');
    expect(normalizePromptContextContent(`a${String.fromCharCode(0x9b)}2Kb`)).toBe('ab');
  });

  it('removes OSC sequences terminated by BEL, ESC backslash, or C1 ST', () => {
    expect(normalizePromptContextContent('a\x1B]0;title\x07b')).toBe('ab');
    expect(
      normalizePromptContextContent(
        'a\x1B]8;;https://example.com\x1B\\link\x1B]8;;\x1B\\b',
      ),
    ).toBe('alinkb');
    expect(
      normalizePromptContextContent(
        `a${String.fromCharCode(0x9d)}title${String.fromCharCode(0x9c)}b`,
      ),
    ).toBe('ab');
  });

  it('drops an unterminated OSC from its introducer through the end of input', () => {
    expect(normalizePromptContextContent('before\x1B]0;unterminated')).toBe('before');
    expect(
      normalizePromptContextContent(
        `before${String.fromCharCode(0x9d)}unterminated`,
      ),
    ).toBe('before');
  });

  it('removes standalone ESC framing, disallowed C0/C1 controls, and DEL', () => {
    const c1 = String.fromCharCode(0x80);
    expect(normalizePromptContextContent(`a\x1B7b\x00c\x01d${c1}e\x7ff`)).toBe(
      'abcdef',
    );
    expect(normalizePromptContextContent('tail\x1B')).toBe('tail');
  });

  it('preserves LF, CR, TAB, printable Unicode, Korean, Markdown, and code fences', () => {
    const text = '## 상태 ✅\r\n\t설명\n\n```ts\nconst 인사 = "안녕";\n```\n';
    expect(normalizePromptContextContent(text)).toBe(text);
  });

  it('preserves printable duplication and does not repair model text', () => {
    const text = 'connect\nconnected is\nis else\nelse';
    expect(normalizePromptContextContent(text)).toBe(text);
  });

  it('is deterministic and idempotent', () => {
    const text = 'a\x1B[Kb\x1B]0;title\x07c\n현재 상태';
    const once = normalizePromptContextContent(text);
    expect(normalizePromptContextContent(text)).toBe(once);
    expect(normalizePromptContextContent(once)).toBe(once);
  });
});
