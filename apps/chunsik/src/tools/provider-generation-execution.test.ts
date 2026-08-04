import { describe, expect, it, vi } from 'vitest';
import { ExternalEgressControl } from '../provider-routing/ollama-preflight/contracts';
import { ModelAcquisitionControl } from './provider-generation-validation';
import { executeProviderGenerationExecution, parseProviderGenerationExecutionInvocation } from './provider-generation-execution';
const flags=['--executable-realpath','--expected-executable-sha256','--expected-executable-size-bytes','--approved-loopback-endpoint','--model-acquisition-control','--external-egress-control'];
const values=['/x/ollama','a'.repeat(64),'1','http://127.0.0.1:11434',ModelAcquisitionControl.PRECHECK_OBSERVE_POSTCHECK_RISK_ACCEPTED,ExternalEgressControl.CONFIG_RESTRICTED_RISK_ACCEPTED];
const argv=values.flatMap((v,i)=>[flags[i]!,v]);
describe('provider generation execution entrypoint',()=>{
  it('parses exact explicit input',()=>expect(parseProviderGenerationExecutionInvocation(argv).expectedExecutableSizeBytes).toBe(1));
  it.each([argv.slice(2),[...argv,'extra'],argv.map((v,i)=>i===1?'A'.repeat(64):v)])('rejects malformed input',bad=>expect(()=>parseProviderGenerationExecutionInvocation(bad)).toThrow());
  it('blocks identity mismatch before the harness',async()=>{const harness=vi.fn();const writes:string[]=[];const result=await executeProviderGenerationExecution(argv,{fileSystem:{realpath:()=>'/other',stat:()=>({kind:'file',sizeBytes:1,mode:0o755}),*readChunks(){yield Buffer.from('x');}} as never,executeHarness:harness,writeProjection:v=>writes.push(v)});expect(result.exitCode).toBe(3);expect(harness).not.toHaveBeenCalled();expect(writes).toHaveLength(1);expect(writes[0]).not.toContain('/other');});
});
