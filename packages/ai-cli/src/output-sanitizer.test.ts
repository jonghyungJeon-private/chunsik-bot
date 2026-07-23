import { describe, expect, it } from 'vitest';
import { sanitizeTerminalOutput } from './output-sanitizer';

describe('sanitizeTerminalOutput', () => {
  it('removes the observed ESC[K sequence and other CSI sequences', () => {
    expect(sanitizeTerminalOutput('before\x1B[Kafter')).toBe('beforeafter');
    expect(sanitizeTerminalOutput('\x1B[31mred\x1B[0m')).toBe('red');
  });

  it('removes OSC sequences terminated by BEL or ST', () => {
    expect(sanitizeTerminalOutput('a\x1B]0;title\x07b')).toBe('ab');
    expect(sanitizeTerminalOutput('a\x1B]8;;https://example.com\x1B\\link\x1B]8;;\x1B\\b')).toBe('alinkb');
  });

  it('removes disallowed C0 controls while preserving newline, carriage return, and tab', () => {
    expect(sanitizeTerminalOutput('a\x00b\x01c\n\r\td')).toBe('abc\n\r\td');
  });

  it('preserves Korean, Unicode, Markdown, and code fences', () => {
    const text = '## 상태 ✅\n\n```ts\nconst 인사 = \"안녕\";\n```\n';
    expect(sanitizeTerminalOutput(text)).toBe(text);
  });

  it('does not remove natural-language parenthetical text', () => {
    const text = "(I'll respond as Quoky, a concise assistant)";
    expect(sanitizeTerminalOutput(text)).toBe(text);
  });
});
