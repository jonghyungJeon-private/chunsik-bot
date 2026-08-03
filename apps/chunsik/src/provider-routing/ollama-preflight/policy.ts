import {
  OllamaPreflightCommandCategory,
  OllamaPreflightError,
  OllamaPreflightFailureCode,
} from './contracts';

const COMMANDS = Object.freeze({
  [OllamaPreflightCommandCategory.VERSION]: Object.freeze(['--version']),
  [OllamaPreflightCommandCategory.INVENTORY]: Object.freeze(['list']),
});

export function argvFor(category: OllamaPreflightCommandCategory): readonly string[] {
  return COMMANDS[category];
}

export function assertAllowedOllamaPreflightCommand(
  category: OllamaPreflightCommandCategory,
  argv: readonly string[],
): void {
  const expected = COMMANDS[category];
  if (argv.length !== expected.length || argv.some((value, index) => value !== expected[index])) {
    throw new OllamaPreflightError(OllamaPreflightFailureCode.INVALID_PREFLIGHT_CONFIGURATION);
  }
}

export function parseApprovedLoopbackEndpoint(value: string): string {
  const match = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):([0-9]{1,5})$/.exec(value);
  const port = Number(match?.[2]);
  if (!match || !Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new OllamaPreflightError(OllamaPreflightFailureCode.REMOTE_HOST_CONFIGURATION_DETECTED);
  }
  return value;
}

export function buildIsolatedOllamaEnvironment(input: {
  readonly home: string;
  readonly tmpdir: string;
  readonly loopbackEndpoint: string;
}): Readonly<Record<string, string>> {
  return Object.freeze({
    HOME: input.home,
    TMPDIR: input.tmpdir,
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    NO_COLOR: '1',
    CLICOLOR: '0',
    CLICOLOR_FORCE: '0',
    OLLAMA_HOST: parseApprovedLoopbackEndpoint(input.loopbackEndpoint),
  });
}
