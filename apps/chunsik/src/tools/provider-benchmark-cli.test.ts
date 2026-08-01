import { describe, expect, it } from 'vitest';
import { runBenchmarkCli } from './provider-benchmark-cli';

describe('provider benchmark CLI', () => {
  it('renders the frozen A1 plan without executing a provider', () => {
    expect(runBenchmarkCli(['--mode', 'plan-stage-a1'])).toMatchObject({
      mode: 'plan-stage-a1',
      status: 'PASS',
      providerExecuted: false,
      budget: {
        generationCalls: 280,
        childCalls: 400,
      },
    });
  });

  it('fails closed for unknown and incomplete summary options', () => {
    expect(() => runBenchmarkCli(['--mode', 'unknown'])).toThrowError('INVALID_MODE');
    expect(() => runBenchmarkCli(['--mode', 'summarize', '--phase', 'A1'])).toThrowError(
      'MISSING_OR_INVALID_SUMMARY_OPTION',
    );
  });
});
