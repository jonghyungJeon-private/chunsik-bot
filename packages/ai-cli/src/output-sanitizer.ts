const ESC = 0x1b;
const BEL = 0x07;
const CSI = 0x9b;
const OSC = 0x9d;
const ST = 0x9c;

function consumeCsi(input: string, start: number): number {
  for (let i = start; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    if (code >= 0x40 && code <= 0x7e) return i + 1;
    if (code < 0x20 || code > 0x3f) return i;
  }
  return input.length;
}

function consumeOsc(input: string, start: number): number {
  for (let i = start; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    if (code === BEL || code === ST) return i + 1;
    if (code === ESC && input.charCodeAt(i + 1) === 0x5c) return i + 2;
  }
  return input.length;
}

function consumeEscape(input: string, start: number): number {
  let i = start;
  while (i < input.length) {
    const code = input.charCodeAt(i);
    if (code < 0x20 || code > 0x2f) break;
    i += 1;
  }
  if (i < input.length) {
    const final = input.charCodeAt(i);
    if (final >= 0x30 && final <= 0x7e) return i + 1;
  }
  return start;
}

/**
 * Remove machine-recognizable terminal framing without interpreting natural
 * language. LF, CR, and TAB are intentionally preserved for Markdown output.
 */
export function sanitizeTerminalOutput(input: string): string {
  let output = '';

  for (let i = 0; i < input.length; ) {
    const code = input.charCodeAt(i);

    if (code === ESC) {
      const next = input.charCodeAt(i + 1);
      if (next === 0x5b) {
        i = consumeCsi(input, i + 2);
        continue;
      }
      if (next === 0x5d) {
        i = consumeOsc(input, i + 2);
        continue;
      }
      i = consumeEscape(input, i + 1);
      continue;
    }

    if (code === CSI) {
      i = consumeCsi(input, i + 1);
      continue;
    }
    if (code === OSC) {
      i = consumeOsc(input, i + 1);
      continue;
    }

    const allowedWhitespace = code === 0x09 || code === 0x0a || code === 0x0d;
    const disallowedControl =
      (!allowedWhitespace && code < 0x20) ||
      code === 0x7f ||
      (code >= 0x80 && code <= 0x9f);
    if (disallowedControl) {
      i += 1;
      continue;
    }

    output += input[i];
    i += 1;
  }

  return output;
}

const INTERNAL_PROVENANCE = 'ASSISTANT';
const INTERNAL_EPISTEMIC_STATUS = 'ASSISTANT_NON_AUTHORITATIVE';

function contentFromJsonEnvelope(input: string): string | null {
  try {
    const envelope = JSON.parse(input) as Record<string, unknown>;
    const role = envelope.role;
    return (role === undefined || role === 'assistant') &&
      envelope.provenance === INTERNAL_PROVENANCE &&
      envelope.epistemicStatus === INTERNAL_EPISTEMIC_STATUS &&
      typeof envelope.content === 'string'
      ? envelope.content
      : null;
  } catch {
    return null;
  }
}

/**
 * Remove only the adapter's machine-recognizable Assistant metadata envelope.
 * Natural-language content is otherwise preserved verbatim; this does not
 * interpret the response or choose user-facing wording.
 */
export function stripInternalMetadataEnvelope(input: string): string {
  const trimmed = input.trim();
  const jsonContent = contentFromJsonEnvelope(trimmed);
  if (jsonContent !== null) return jsonContent;

  const lines = input.split(/\r?\n/u);
  const output: string[] = [];

  const decodeContentLine = (line: string): string | null => {
    const normalized = line.trim();
    if (!normalized.startsWith('Content: ')) return null;
    try {
      const content = JSON.parse(normalized.slice('Content: '.length)) as unknown;
      return typeof content === 'string' ? content : null;
    } catch {
      return null;
    }
  };

  for (let index = 0; index < lines.length; index += 1) {
    const normalized = (lines[index] ?? '').trim();

    if (normalized === '# Role-attributed conversation') continue;
    if (/^## (?:SYSTEM|USER|ASSISTANT|UNKNOWN) message$/u.test(normalized)) continue;
    if (/^Provenance: [A-Z][A-Z_]*$/u.test(normalized)) continue;
    if (/^Epistemic status: [A-Z][A-Z_]*$/u.test(normalized)) continue;

    const content = decodeContentLine(lines[index] ?? '');
    if (content !== null) {
      output.push(content);
      continue;
    }

    output.push(lines[index] ?? '');
  }

  while (output[0]?.trim() === '') output.shift();
  while (output.at(-1)?.trim() === '') output.pop();
  return output.join('\n');
}
