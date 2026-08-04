import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { ExternalEgressControl, OllamaPreflightStatus } from '../provider-routing/ollama-preflight/contracts';
import { assertOllamaExecutableIdentity } from '../provider-routing/ollama-preflight/executable-identity';
import { ContainedOllamaPreflightProcessRunner } from '../provider-routing/ollama-preflight/process-runner';
import { OllamaInventoryPreflight } from '../provider-routing/ollama-preflight/preflight';
import { createRunnerOwnedOllamaSandbox, NodeOllamaPreflightFileSystem } from './ollama-preflight-execution';
import { executeProviderGenerationValidation, ModelAcquisitionControl } from './provider-generation-validation';
import type { ProviderGenerationValidationProjection } from './provider-generation-validation';

export const PROVIDER_GENERATION_EXECUTION_CONTRACT_VERSION = 'stage2b-provider-generation-execution-v1' as const;
const FLAGS = ['--executable-realpath','--expected-executable-sha256','--expected-executable-size-bytes','--approved-loopback-endpoint','--model-acquisition-control','--external-egress-control'] as const;
export interface Invocation { executableRealpath:string; expectedExecutableSha256:string; expectedExecutableSizeBytes:number; approvedLoopbackEndpoint:string; modelAcquisitionControl:ModelAcquisitionControl; externalEgressControl:ExternalEgressControl }
export function parseProviderGenerationExecutionInvocation(argv: readonly string[]): Invocation {
  const values = new Map<string,string>();
  for (let i=0;i<argv.length;i+=2) { const f=argv[i],v=argv[i+1]; if (!f||!v||!FLAGS.includes(f as typeof FLAGS[number])||values.has(f)||v.startsWith('--')) throw new Error('INVALID_INVOCATION'); values.set(f,v); }
  if (values.size!==FLAGS.length) throw new Error('INVALID_INVOCATION');
  const executableRealpath=values.get(FLAGS[0])!; const hash=values.get(FLAGS[1])!; const sizeText=values.get(FLAGS[2])!; const endpoint=values.get(FLAGS[3])!;
  const acquisition=values.get(FLAGS[4]) as ModelAcquisitionControl; const egress=values.get(FLAGS[5]) as ExternalEgressControl;
  let url:URL; try { url=new URL(endpoint); } catch { throw new Error('INVALID_INVOCATION'); }
  if (!isAbsolute(executableRealpath)||!/^[0-9a-f]{64}$/.test(hash)||!/^[1-9][0-9]*$/.test(sizeText)||!Number.isSafeInteger(Number(sizeText))||url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||url.pathname!=='/'||!Object.values(ModelAcquisitionControl).includes(acquisition)||!Object.values(ExternalEgressControl).includes(egress)) throw new Error('INVALID_INVOCATION');
  return Object.freeze({executableRealpath,expectedExecutableSha256:hash,expectedExecutableSizeBytes:Number(sizeText),approvedLoopbackEndpoint:endpoint,modelAcquisitionControl:acquisition,externalEgressControl:egress});
}
export interface ExecutionDependencies { fileSystem?:NodeOllamaPreflightFileSystem; executeHarness?:typeof executeProviderGenerationValidation; writeProjection?:(value:string)=>void; verifyModelAcquisitionDenied?:()=>boolean; verifyOsDenied?:()=>boolean }
const empty=(status:string,failureCode:string,harnessInvocationCount=0)=>({entrypointContractVersion:PROVIDER_GENERATION_EXECUTION_CONTRACT_VERSION,status,failureCode,harnessInvocationCount,identityVerified:false,selectedProviderId:null,selectedAdapterId:null,selectedModelId:null,planAttemptCount:0,providerExecutionCount:0,retryCount:0,fallbackCount:0,escalationCount:0,normalizedOutput:null,normalizedOutputDigest:null,normalizedOutputBytes:0,expectedOutputMatched:false,modelAcquisitionControl:null,modelDownloadPreventionVerified:false,downloadCapableCommandInvoked:false,downloadObserved:false,preflightPassed:false,postflightPassed:false,inventoryUnchanged:false,timedOut:false,outputOverflowed:false,externalEgressControl:null,externalEgressIsolationVerified:false,networkClass:null,checks:[]});
export async function executeProviderGenerationExecution(argv:readonly string[], deps:ExecutionDependencies={}) {
  const writer=deps.writeProjection??((v:string)=>process.stdout.write(`${v}\n`)); let emitted=false; const emit=(p:object)=>{if(emitted)return; emitted=true; writer(JSON.stringify(p));};
  let input:Invocation; try { input=parseProviderGenerationExecutionInvocation(argv); } catch { const p=empty('BLOCKED','INVALID_INVOCATION'); try{emit(p);}catch{} return {exitCode:4,projection:p}; }
  const fs=deps.fileSystem??new NodeOllamaPreflightFileSystem();
  try { assertOllamaExecutableIdentity({realPath:input.executableRealpath,identity:{contractVersion:'stage2b-ollama-executable-identity-v1',identityDigest:input.expectedExecutableSha256,sizeBytes:input.expectedExecutableSizeBytes,modeClass:'EXECUTABLE',pathKind:'ABSOLUTE_REALPATH'}},input.executableRealpath,fs); } catch { const p=empty('BLOCKED','EXECUTABLE_IDENTITY_MISMATCH'); try{emit(p);}catch{} return {exitCode:3,projection:p}; }
  let count=0; try {
    const harness=deps.executeHarness??executeProviderGenerationValidation;
    const projection=await harness({executableRealpath:input.executableRealpath,approvedLoopbackEndpoint:input.approvedLoopbackEndpoint,modelAcquisitionControl:input.modelAcquisitionControl},{verifyModelAcquisitionDenied:deps.verifyModelAcquisitionDenied,runPreflight:async()=>{const runner=new ContainedOllamaPreflightProcessRunner((c,a,o)=>spawn(c,[...a],o),createRunnerOwnedOllamaSandbox); const result=await new OllamaInventoryPreflight(fs,runner).execute({executablePath:input.executableRealpath,approvedExecutable:{realPath:input.executableRealpath,identity:{contractVersion:'stage2b-ollama-executable-identity-v1',identityDigest:input.expectedExecutableSha256,sizeBytes:input.expectedExecutableSizeBytes,modeClass:'EXECUTABLE',pathKind:'ABSOLUTE_REALPATH'}},loopbackEndpoint:input.approvedLoopbackEndpoint,externalEgressControl:input.externalEgressControl,externalEgressIsolationVerified:input.externalEgressControl===ExternalEgressControl.OS_DENIED_VERIFIED&&deps.verifyOsDenied?.()===true}); return {passed:result.status===OllamaPreflightStatus.PASS,requiredModelPresent:result.installedRequiredModels.includes('llama3.1:8b'),inventoryFingerprint:result.inventoryFingerprint,externalEgressControl:result.externalEgressControl,externalEgressIsolationVerified:result.externalEgressIsolationVerified,networkClass:result.networkClass};}}); count=1;
    const p={entrypointContractVersion:PROVIDER_GENERATION_EXECUTION_CONTRACT_VERSION,...projection,harnessInvocationCount:count,identityVerified:true}; emit(p); return {exitCode:projection.status==='PASS'?0:projection.status==='FAIL'?2:3,projection:p};
  } catch { const p=empty('BLOCKED','UNEXPECTED_ENTRYPOINT_FAILURE',count); try{emit(p);}catch{} return {exitCode:5,projection:p}; }
}
if(require.main===module) void executeProviderGenerationExecution(process.argv.slice(2)).then(r=>{process.exitCode=r.exitCode;});
