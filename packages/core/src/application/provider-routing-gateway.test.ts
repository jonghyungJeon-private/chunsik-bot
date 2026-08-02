import { describe, expect, it, vi } from 'vitest';
import { AiFailureKind, Capability } from '../domain';
import { AiProviderError } from '../errors';
import type { AiExecutionResult, AiProvider, AiRequest } from '../ports';
import { ProviderBindingRegistry } from './provider-binding-registry';
import {
  ProviderExecutionPlan,
  ProviderExecutionPlanError,
  ProviderExecutionPlanner,
} from './provider-execution-plan';
import {
  ProviderExecutionOutcome,
  ProviderRoutingGateway,
} from './provider-routing-gateway';
import {
  ProviderSelectionDecision,
  RoutingConfigurationError,
  RoutingReasonCode,
  policyId,
  providerId,
  validationProfileId,
} from './provider-routing-contracts';

const REQUEST: AiRequest = {
  capability: Capability.GENERAL_CHAT,
  prompt: 'private request body',
  metadata: { privateInput: 'not-for-audit' },
};

const DECISION: ProviderSelectionDecision = {
  selectedProviderId: providerId('provider-a'),
  eligibleProviderIds: [providerId('provider-a'), providerId('provider-b')],
  matchedPolicyId: policyId('balanced-v1'),
  reasonCode: RoutingReasonCode.SELECTED,
  policyVersion: 'policy-v1',
  registryVersion: 'registry-v1',
  configurationDigest: 'b'.repeat(64),
};

const plan = (): ProviderExecutionPlan =>
  new ProviderExecutionPlanner().create(DECISION, {
    capability: Capability.GENERAL_CHAT,
    validationProfile: validationProfileId('general-chat-v1'),
  });

function fakeProvider(
  id: string,
  execute: (request: AiRequest) => Promise<AiExecutionResult>,
): AiProvider & { execute: ReturnType<typeof vi.fn>; isAvailable: ReturnType<typeof vi.fn> } {
  return {
    id,
    capabilities: [{ capability: Capability.GENERAL_CHAT, priority: 1 }],
    isAvailable: vi.fn(async () => true),
    execute: vi.fn(execute),
  };
}

const bindings = (...providers: AiProvider[]): ProviderBindingRegistry =>
  new ProviderBindingRegistry(
    providers.map((provider) => ({ providerId: providerId(provider.id), provider })),
  );

describe('ProviderBindingRegistry', () => {
  it('is an immutable, stable executable binding lookup without invoking Providers', () => {
    const a = fakeProvider('provider-a', async () => ({ text: 'a' }));
    const b = fakeProvider('provider-b', async () => ({ text: 'b' }));
    const registry = bindings(b, a);
    expect(registry.all().map((binding) => binding.providerId)).toEqual(['provider-a', 'provider-b']);
    expect(registry.get(providerId('provider-a'))).toBe(a);
    expect(Object.isFrozen(registry)).toBe(true);
    expect(Object.isFrozen(registry.all())).toBe(true);
    expect(a.execute).not.toHaveBeenCalled();
    expect(a.isAvailable).not.toHaveBeenCalled();
  });

  it('fails fast on empty, duplicate, invalid, and mismatched bindings', () => {
    const a = fakeProvider('provider-a', async () => ({ text: 'a' }));
    expect(() => new ProviderBindingRegistry([])).toThrow(RoutingConfigurationError);
    expect(() => bindings(a, a)).toThrow(/Duplicate/);
    expect(
      () =>
        new ProviderBindingRegistry([
          { providerId: providerId('provider-b'), provider: a },
        ]),
    ).toThrow(/mismatch/);
    expect(
      () =>
        new ProviderBindingRegistry([
          { providerId: 'bad id' as ReturnType<typeof providerId>, provider: a },
        ]),
    ).toThrow(/Invalid/);
  });
});

describe('ProviderRoutingGateway — Slice 2 single attempt', () => {
  it('invokes exactly the selected Provider once and returns bounded success audit', async () => {
    const selected = fakeProvider('provider-a', async () => ({
      text: 'answer',
      raw: { providerPrivate: 'not-copied-to-routing-audit' },
    }));
    const other = fakeProvider('provider-b', async () => ({ text: 'other' }));
    const result = await new ProviderRoutingGateway(bindings(other, selected)).execute(plan(), REQUEST);

    expect(selected.execute).toHaveBeenCalledTimes(1);
    expect(selected.execute).toHaveBeenCalledWith(REQUEST);
    expect(selected.isAvailable).not.toHaveBeenCalled();
    expect(other.execute).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: ProviderExecutionOutcome.SUCCEEDED,
      result: { text: 'answer' },
      audit: {
        schemaVersion: 'provider-execution-audit-v1',
        providerId: 'provider-a',
        executionOrder: ['provider-a'],
        attemptBudget: 1,
        attemptCount: 1,
        outcome: ProviderExecutionOutcome.SUCCEEDED,
        failureKind: null,
        capability: Capability.GENERAL_CHAT,
        validationProfile: 'general-chat-v1',
        matchedPolicyId: 'balanced-v1',
        policyVersion: 'policy-v1',
        registryVersion: 'registry-v1',
        configurationDigest: 'b'.repeat(64),
        fallbackAttempted: false,
        escalationAttempted: false,
      },
    });
    expect(JSON.stringify(result.audit)).not.toMatch(/private request|privateInput|providerPrivate|reasoning/);
    expect(Object.isFrozen(result.audit)).toBe(true);
    expect(Object.isFrozen(result.audit.executionOrder)).toBe(true);
  });

  it('classifies an AiProviderError without retry or fallback', async () => {
    const selected = fakeProvider('provider-a', async () => {
      throw new AiProviderError(AiFailureKind.TIMEOUT, 'masked provider detail');
    });
    const fallback = fakeProvider('provider-b', async () => ({ text: 'must not run' }));
    const result = await new ProviderRoutingGateway(bindings(selected, fallback)).execute(plan(), REQUEST);

    expect(result).toMatchObject({
      status: ProviderExecutionOutcome.FAILED,
      failureKind: AiFailureKind.TIMEOUT,
      audit: {
        attemptCount: 1,
        failureKind: AiFailureKind.TIMEOUT,
        fallbackAttempted: false,
        escalationAttempted: false,
      },
    });
    expect(selected.execute).toHaveBeenCalledTimes(1);
    expect(fallback.execute).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('masked provider detail');
  });

  it('maps an unknown error to bounded EXECUTION_FAILED without retry', async () => {
    const selected = fakeProvider('provider-a', async () => {
      throw new Error('raw implementation stack detail');
    });
    const result = await new ProviderRoutingGateway(bindings(selected)).execute(plan(), REQUEST);
    expect(result).toMatchObject({
      status: ProviderExecutionOutcome.FAILED,
      failureKind: AiFailureKind.EXECUTION_FAILED,
    });
    expect(selected.execute).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain('raw implementation stack detail');
  });

  it('does not perform Runtime response validation in Slice 2', async () => {
    const selected = fakeProvider('provider-a', async () => ({ text: '' }));
    const result = await new ProviderRoutingGateway(bindings(selected)).execute(plan(), REQUEST);
    expect(result.status).toBe(ProviderExecutionOutcome.SUCCEEDED);
    expect(selected.execute).toHaveBeenCalledTimes(1);
  });

  it('fails before invocation when the selected binding is absent', async () => {
    const other = fakeProvider('provider-b', async () => ({ text: 'other' }));
    await expect(new ProviderRoutingGateway(bindings(other)).execute(plan(), REQUEST)).rejects.toThrow(
      /no executable binding/,
    );
    expect(other.execute).not.toHaveBeenCalled();
  });

  it('fails before invocation on capability mismatch', async () => {
    const selected = fakeProvider('provider-a', async () => ({ text: 'answer' }));
    await expect(
      new ProviderRoutingGateway(bindings(selected)).execute(plan(), {
        ...REQUEST,
        capability: Capability.SUMMARIZATION,
      }),
    ).rejects.toThrow(/capability/);
    expect(selected.execute).not.toHaveBeenCalled();
  });

  it.each([
    ['multiple execution order', { executionOrder: [providerId('provider-a'), providerId('provider-b')] }],
    ['attempt budget', { attemptBudget: 2 }],
    ['deadline', { overallDeadlineMs: 1_000 }],
    ['fallback', { fallbackEligible: true }],
    ['escalation', { escalationEligible: true }],
  ])('rejects forged %s policy before invocation', async (_name, patch) => {
    const selected = fakeProvider('provider-a', async () => ({ text: 'answer' }));
    const forged = { ...plan(), ...patch } as unknown as ProviderExecutionPlan;
    await expect(new ProviderRoutingGateway(bindings(selected)).execute(forged, REQUEST)).rejects.toThrow(
      ProviderExecutionPlanError,
    );
    expect(selected.execute).not.toHaveBeenCalled();
  });
});
