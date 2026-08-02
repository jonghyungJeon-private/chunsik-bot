import { describe, expect, it } from 'vitest';
import {
  ResponseValidationReasonCode,
  RuntimeValidationRule,
  ValidationDisposition,
} from './runtime-response-validation-contracts';
import { RuntimeResponseValidator, projectBoundedProviderOutput } from './runtime-response-validator';
import { validationProfileId } from './provider-routing-contracts';
import {
  AUTHORITY_SENSITIVE,
  GENERAL_CHAT,
  LOW_RISK_FAST_PATH,
  ValidationProfileRegistry,
  createDefaultValidationProfileRegistry,
} from './validation-profile-registry';

const validator = new RuntimeResponseValidator(createDefaultValidationProfileRegistry());

function validate(
  text: string,
  profile = GENERAL_CHAT,
  prompt = 'Please summarize the public project status.',
  contextCorpus: readonly string[] = [],
) {
  return validator.validate({
    validationProfile: profile,
    prompt,
    contextCorpus,
    result: { text },
  });
}

describe('RuntimeResponseValidator', () => {
  it('returns a byte-identical frozen result for the same input without copying bodies', () => {
    const input = {
      validationProfile: GENERAL_CHAT,
      prompt: 'raw private prompt that must never be copied',
      contextCorpus: ['raw private context entry that must never be copied'],
      result: {
        text: 'A concise public answer.',
        raw: { stderr: 'secret raw debug' },
        audit: { environment: 'private environment' },
      },
    } as const;
    const first = validator.validate(input);
    const second = validator.validate(input);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first).toEqual(second);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.reasonCodes)).toBe(true);
    expect(JSON.stringify(first)).not.toMatch(/raw private|stderr|environment|public answer/);
  });

  it('rejects empty and output-limit violations', () => {
    expect(validate('   ', LOW_RISK_FAST_PATH)).toMatchObject({
      disposition: ValidationDisposition.REJECT,
      reasonCodes: [ResponseValidationReasonCode.EMPTY_OUTPUT],
    });
    const tinyProfile = validationProfileId('TINY_PROFILE');
    const tinyValidator = new RuntimeResponseValidator(
      new ValidationProfileRegistry([
        {
          profileId: tinyProfile,
          version: '1',
          rules: [RuntimeValidationRule.NON_EMPTY, RuntimeValidationRule.OUTPUT_LIMIT],
          outputLimitBytes: 24,
          escalationEnabled: false,
        },
      ]),
    );
    expect(
      tinyValidator.validate({ validationProfile: tinyProfile, prompt: 'short prompt', result: { text: 'too long' } }),
    ).toMatchObject({
      disposition: ValidationDisposition.REJECT,
      reasonCodes: [ResponseValidationReasonCode.OUTPUT_LIMIT_VIOLATION],
    });
  });

  it('rejects prompt leak, multi-entry echo, and secret exposure as safety reasons', () => {
    const leakedPrompt = 'The private instruction contains enough canonical words to exceed the bounded matching window safely.';
    expect(validate(`Prefix: ${leakedPrompt}`, GENERAL_CHAT, leakedPrompt).reasonCodes).toContain(
      ResponseValidationReasonCode.PROMPT_LEAK,
    );

    const corpus = [
      'First protected context entry contains private operational details.',
      'Second protected context entry contains private customer details.',
    ];
    const echo = validate(`Summary: ${corpus.join(' ')}`, GENERAL_CHAT, 'Unrelated short prompt.', corpus);
    expect(echo.disposition).toBe(ValidationDisposition.REJECT);
    expect(echo.reasonCodes).toContain(ResponseValidationReasonCode.MULTI_ENTRY_ECHO);

    const secret = validate('The token is github_pat_abcdefghijklmnop123456.');
    expect(secret.disposition).toBe(ValidationDisposition.REJECT);
    expect(secret.reasonCodes).toContain(ResponseValidationReasonCode.SECRET_EXPOSURE_RISK);
  });

  it('allows semantic escalation only for the authority-sensitive profile', () => {
    const claim = 'I verified that the production service is currently healthy.';
    expect(validate(claim, GENERAL_CHAT)).toMatchObject({
      disposition: ValidationDisposition.ACCEPT,
      reasonCodes: [],
    });
    expect(validate(claim, AUTHORITY_SENSITIVE)).toMatchObject({
      disposition: ValidationDisposition.ESCALATE,
      reasonCodes: [ResponseValidationReasonCode.AUTHORITY_SCOPE_VIOLATION],
    });
    expect(validate('I cannot verify whether the production service is currently healthy.', AUTHORITY_SENSITIVE)).toMatchObject({
      disposition: ValidationDisposition.ACCEPT,
      reasonCodes: [],
    });
  });

  it('fails closed with a bounded result when validation cannot process malformed input', () => {
    const result = validator.validate({
      validationProfile: GENERAL_CHAT,
      prompt: 'safe prompt',
      result: { text: null as unknown as string, raw: { stack: 'private stack' } },
    });
    expect(result).toMatchObject({
      disposition: ValidationDisposition.REJECT,
      reasonCodes: [ResponseValidationReasonCode.VALIDATOR_INTERNAL_FAILURE],
    });
    expect(JSON.stringify(result)).not.toMatch(/private stack/);
  });

  it('projects only accepted output and strips raw, audit, uri, and artifact metadata', () => {
    const result = {
      text: 'Validated response.',
      artifacts: [
        {
          id: 'artifact-1',
          kind: 'DOCUMENT',
          title: 'Result',
          content: 'bounded content',
          uri: '/private/runtime/path',
          metadata: { providerDebug: 'secret' },
          createdAt: '2026-08-02T00:00:00.000Z',
        },
      ],
      raw: { stderr: 'private' },
      audit: { environment: 'private' },
    } as const;
    const validation = validator.validate({
      validationProfile: GENERAL_CHAT,
      prompt: 'Short unrelated prompt.',
      result,
    });
    const bounded = projectBoundedProviderOutput(result, validation);

    expect(bounded).toMatchObject({ text: 'Validated response.', artifacts: [{ title: 'Result' }] });
    expect(JSON.stringify(bounded)).not.toMatch(/providerDebug|runtime\/path|stderr|environment/);
    expect(Object.isFrozen(bounded)).toBe(true);
    expect(Object.isFrozen(bounded.artifacts)).toBe(true);
    expect(Object.isFrozen(bounded.artifacts[0])).toBe(true);
    expect(() => projectBoundedProviderOutput({ text: 'changed' }, validation)).toThrow(/does not match/);
  });
});
