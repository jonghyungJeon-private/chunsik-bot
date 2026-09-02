import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { AgentProfileRegistry } from '@chunsik/core';
import { agentProfileRegistryProvider } from './agent-profile-registry-provider';

@Module({ providers: [agentProfileRegistryProvider] })
class AgentProfileCompositionModule {}

describe('AgentProfileRegistry composition', () => {
  it('resolves the real empty composition-time registry without a fallback agent', async () => {
    const application = await NestFactory.createApplicationContext(AgentProfileCompositionModule, { logger: false });
    try {
      expect(application.get(AgentProfileRegistry).list()).toEqual([]);
    } finally {
      await application.close();
    }
  });
});
