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

  return stripInternalMetadataEnvelope(output);
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
function stripInternalMetadataEnvelope(input: string): string {
  const trimmed = input.trim();
  const jsonContent = contentFromJsonEnvelope(trimmed);
  if (jsonContent !== null) return jsonContent;

  const lines = input.split(/\r?\n/u);
  let index = 0;
  if (/^## ASSISTANT message\s*$/iu.test(lines[index] ?? '')) index += 1;
  if ((lines[index] ?? '').trim() !== `Provenance: ${INTERNAL_PROVENANCE}`) return input;
  index += 1;
  if (
    (lines[index] ?? '').trim() !==
    `Epistemic status: ${INTERNAL_EPISTEMIC_STATUS}`
  ) {
    return input;
  }
  index += 1;

  const contentLine = lines[index] ?? '';
  if (contentLine.startsWith('Content: ')) {
    const encodedContent = contentLine.slice('Content: '.length);
    try {
      const content = JSON.parse(encodedContent) as unknown;
      if (typeof content === 'string' && index === lines.length - 1) return content;
    } catch {
      // Fall through and preserve a non-canonical Content line as response text.
    }
  }

  while ((lines[index] ?? '').trim() === '') index += 1;
  return lines.slice(index).join('\n');
}
