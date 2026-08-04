import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';
import {
  ExternalEgressControl, MAX_EXECUTABLE_BYTES, OLLAMA_EXECUTABLE_IDENTITY_VERSION,
  OllamaPreflightStatus,
} from '../provider-routing/ollama-preflight/contracts';
import type { ApprovedOllamaExecutable } from '../provider-routing/ollama-preflight/contracts';
import { assertOllamaExecutableIdentity } from '../provider-routing/ollama-preflight/executable-identity';
import { parseApprovedLoopbackEndpoint } from '../provider-routing/ollama-preflight/policy';
import { ContainedOllamaPreflightProcessRunner } from '../provider-routing/ollama-preflight/process-runner';
import { OllamaInventoryPreflight } from '../provider-routing/ollama-preflight/preflight';
import { createRunnerOwnedOllamaSandbox, NodeOllamaPreflightFileSystem } from './ollama-preflight-execution';
import {
  executeProviderGenerationValidation, ModelAcquisitionControl,
  PROVIDER_GENERATION_VALIDATION_CONTRACT_VERSION, VALIDATION_PROMPT_DIGEST,
} from './provider-generation-validation';
import type {
  GenerationInventorySnapshot, ProviderGenerationValidationDependencies,
  ProviderGenerationValidationProjection, GenerationValidationFailureCode,
} from './provider-generation-validation';

export const PROVIDER_GENERATION_EXECUTION_CONTRACT_VERSION =
  'stage2b-provider-generation-execution-v1' as const;
export const PROVIDER_GENERATION_EXECUTION_PROJECTION_KEYS = Object.freeze([
  'entrypointContractVersion','contractVersion','status','failureCode','promptDigest',
  'harnessInvocationCount','identityVerified','selectedProviderId','selectedAdapterId',
  'selectedModelId','planAttemptCount','providerExecutionCount','retryCount','fallbackCount',
  'escalationCount','normalizedOutput','normalizedOutputDigest','normalizedOutputBytes',
  'expectedOutputMatched','modelAcquisitionControl','modelDownloadPreventionVerified',
  'downloadCapableCommandInvoked','downloadObserved','preflightPassed','postflightPassed',
  'inventoryUnchanged','timedOut','outputOverflowed','externalEgressControl',
  'externalEgressIsolationVerified','networkClass','checks',
] as const);
const FLAGS = Object.freeze([
  '--executable-realpath','--expected-executable-sha256','--expected-executable-size-bytes',
  '--approved-loopback-endpoint','--model-acquisition-control','--external-egress-control',
] as const);
type Status = 'PASS'|'FAIL'|'BLOCKED';
type EntrypointFailureCode =
  | GenerationValidationFailureCode
  | 'INVALID_INVOCATION'
  | 'EXECUTABLE_IDENTITY_MISMATCH'
  | 'UNEXPECTED_ENTRYPOINT_FAILURE'
  | null;
export interface Invocation {
  readonly executableRealpath:string; readonly expectedExecutableSha256:string;
  readonly expectedExecutableSizeBytes:number; readonly approvedLoopbackEndpoint:string;
  readonly modelAcquisitionControl:ModelAcquisitionControl;
  readonly externalEgressControl:ExternalEgressControl;
}
export interface EntrypointProjection {
  readonly entrypointContractVersion:typeof PROVIDER_GENERATION_EXECUTION_CONTRACT_VERSION;
  readonly contractVersion:typeof PROVIDER_GENERATION_VALIDATION_CONTRACT_VERSION;
  readonly status:Status; readonly failureCode:EntrypointFailureCode; readonly promptDigest:typeof VALIDATION_PROMPT_DIGEST;
  readonly harnessInvocationCount:number; readonly identityVerified:boolean;
  readonly selectedProviderId:string|null; readonly selectedAdapterId:string|null; readonly selectedModelId:string|null;
  readonly planAttemptCount:number; readonly providerExecutionCount:number; readonly retryCount:number;
  readonly fallbackCount:number; readonly escalationCount:number; readonly normalizedOutput:string|null;
  readonly normalizedOutputDigest:string|null; readonly normalizedOutputBytes:number;
  readonly expectedOutputMatched:boolean; readonly modelAcquisitionControl:ModelAcquisitionControl|null;
  readonly modelDownloadPreventionVerified:boolean; readonly downloadCapableCommandInvoked:boolean;
  readonly downloadObserved:boolean; readonly preflightPassed:boolean; readonly postflightPassed:boolean;
  readonly inventoryUnchanged:boolean; readonly timedOut:boolean; readonly outputOverflowed:boolean;
  readonly externalEgressControl:ExternalEgressControl|null; readonly externalEgressIsolationVerified:boolean;
  readonly networkClass:'LOOPBACK_DAEMON'|null;
  readonly checks:readonly Readonly<{code:string;status:'PASS'|'FAIL'|'BLOCKED'}>[];
}
class InvalidInvocation extends Error {}
function invalid():never { throw new InvalidInvocation(); }
export function parseProviderGenerationExecutionInvocation(argv:readonly string[]):Invocation {
  const values=new Map<string,string>();
  for(let index=0;index<argv.length;index+=2){
    const flag=argv[index]; const value=argv[index+1];
    if(flag===undefined||value===undefined||!FLAGS.includes(flag as typeof FLAGS[number])||
      values.has(flag)||value.startsWith('--')) invalid();
    values.set(flag,value);
  }
  if(values.size!==FLAGS.length) invalid();
  const executableRealpath=values.get(FLAGS[0]); const hash=values.get(FLAGS[1]);
  const sizeText=values.get(FLAGS[2]); const endpointInput=values.get(FLAGS[3]);
  const acquisition=values.get(FLAGS[4]); const egress=values.get(FLAGS[5]);
  if(executableRealpath===undefined||hash===undefined||sizeText===undefined||endpointInput===undefined||
    acquisition===undefined||egress===undefined||!isAbsolute(executableRealpath)||
    !/^[0-9a-f]{64}$/.test(hash)||!/^[1-9][0-9]*$/.test(sizeText)) invalid();
  const size=Number(sizeText);
  if(!Number.isSafeInteger(size)||size<=0||size>MAX_EXECUTABLE_BYTES) invalid();
  const endpoint=(()=>{try{
    const parsedEndpoint=new URL(endpointInput);
    if(parsedEndpoint.hostname!=='127.0.0.1')invalid();
    return parseApprovedLoopbackEndpoint(endpointInput);
  }catch{invalid();}})();
  if(!Object.values(ModelAcquisitionControl).includes(acquisition as ModelAcquisitionControl)||
    !Object.values(ExternalEgressControl).includes(egress as ExternalEgressControl)) invalid();
  return Object.freeze({executableRealpath,expectedExecutableSha256:hash,expectedExecutableSizeBytes:size,
    approvedLoopbackEndpoint:endpoint,modelAcquisitionControl:acquisition as ModelAcquisitionControl,
    externalEgressControl:egress as ExternalEgressControl});
}
type Harness = typeof executeProviderGenerationValidation;
export interface ExecutionDependencies {
  readonly fileSystem?:NodeOllamaPreflightFileSystem; readonly executeHarness?:Harness;
  readonly runPreflight?:(phase:'PRE'|'POST',input:Invocation)=>Promise<GenerationInventorySnapshot>;
  readonly writeProjection?:(value:string)=>void; readonly verifyModelAcquisitionDenied?:()=>boolean;
  readonly verifyOsDenied?:()=>boolean;
}
interface Lifecycle { identityVerified:boolean; harnessInvocationCount:number;
  latestHarnessProjection:ProviderGenerationValidationProjection|null;
  projectionEmissionAttemptCount:number; projectionEmissionSucceeded:boolean; }
const GENERATION_FAILURE_CODES = Object.freeze([
  'PRIMARY_ONLY_PLAN_REQUIRED', 'MODEL_NOT_AVAILABLE', 'MODEL_DOWNLOAD_RISK_UNCONTROLLED',
  'MODEL_DOWNLOAD_DETECTED', 'PRE_GENERATION_PREFLIGHT_FAILED', 'POST_GENERATION_PREFLIGHT_FAILED',
  'INVENTORY_CHANGED', 'EXPECTED_OUTPUT_MISMATCH', 'OUTPUT_OVERFLOW',
  'PROVIDER_EXECUTION_COUNT_EXCEEDED', 'PROVIDER_EXECUTION_FAILED',
] as const satisfies readonly GenerationValidationFailureCode[]);

function boundedHarnessFailureCode(
  failureCode: ProviderGenerationValidationProjection['failureCode'],
): EntrypointFailureCode {
  if (failureCode === null) return null;
  return GENERATION_FAILURE_CODES.includes(failureCode as GenerationValidationFailureCode)
    ? failureCode as GenerationValidationFailureCode
    : 'UNEXPECTED_ENTRYPOINT_FAILURE';
}

function projectionOf(lifecycle:Lifecycle,status:Status,failureCode:EntrypointFailureCode):EntrypointProjection {
  const p=lifecycle.latestHarnessProjection;
  return Object.freeze({entrypointContractVersion:PROVIDER_GENERATION_EXECUTION_CONTRACT_VERSION,
    contractVersion:PROVIDER_GENERATION_VALIDATION_CONTRACT_VERSION,status,failureCode,
    promptDigest:VALIDATION_PROMPT_DIGEST,harnessInvocationCount:lifecycle.harnessInvocationCount,
    identityVerified:lifecycle.identityVerified,selectedProviderId:p?.selectedProviderId??null,
    selectedAdapterId:p?.selectedAdapterId??null,selectedModelId:p?.selectedModelId??null,
    planAttemptCount:p?.planAttemptCount??0,providerExecutionCount:p?.providerExecutionCount??0,
    retryCount:p?.retryCount??0,fallbackCount:p?.fallbackCount??0,escalationCount:p?.escalationCount??0,
    normalizedOutput:p?.normalizedOutput??null,normalizedOutputDigest:p?.normalizedOutputDigest??null,
    normalizedOutputBytes:p?.normalizedOutputBytes??0,expectedOutputMatched:p?.expectedOutputMatched??false,
    modelAcquisitionControl:p?.modelAcquisitionControl??null,
    modelDownloadPreventionVerified:p?.modelDownloadPreventionVerified??false,
    downloadCapableCommandInvoked:p?.downloadCapableCommandInvoked??false,
    downloadObserved:p?.downloadObserved??false,preflightPassed:p?.preflightPassed??false,
    postflightPassed:p?.postflightPassed??false,inventoryUnchanged:p?.inventoryUnchanged??false,
    timedOut:p?.timedOut??false,outputOverflowed:p?.outputOverflowed??false,
    externalEgressControl:p?.externalEgressControl??null,
    externalEgressIsolationVerified:p?.externalEgressIsolationVerified??false,
    networkClass:p?.networkClass??null,checks:Object.freeze([...(p?.checks??[])]),});
}
function approved(input:Invocation):ApprovedOllamaExecutable{return Object.freeze({realPath:input.executableRealpath,
  identity:Object.freeze({contractVersion:OLLAMA_EXECUTABLE_IDENTITY_VERSION,
    identityDigest:input.expectedExecutableSha256,sizeBytes:input.expectedExecutableSizeBytes,
    modeClass:'EXECUTABLE',pathKind:'ABSOLUTE_REALPATH'})});}
async function concretePreflight(phase:'PRE'|'POST',input:Invocation,deps:ExecutionDependencies,
  fileSystem:NodeOllamaPreflightFileSystem):Promise<GenerationInventorySnapshot>{
  void phase;
  const runner=new ContainedOllamaPreflightProcessRunner((command,args,options)=>spawn(command,[...args],options),
    createRunnerOwnedOllamaSandbox);
  const result=await new OllamaInventoryPreflight(fileSystem,runner).execute({executablePath:input.executableRealpath,
    approvedExecutable:approved(input),loopbackEndpoint:input.approvedLoopbackEndpoint,
    externalEgressControl:input.externalEgressControl,
    externalEgressIsolationVerified:input.externalEgressControl===ExternalEgressControl.OS_DENIED_VERIFIED&&
      deps.verifyOsDenied?.()===true});
  return Object.freeze({passed:result.status===OllamaPreflightStatus.PASS,
    requiredModelPresent:result.installedRequiredModels.includes('llama3.1:8b'),
    inventoryFingerprint:result.inventoryFingerprint,externalEgressControl:result.externalEgressControl,
    externalEgressIsolationVerified:result.externalEgressIsolationVerified,networkClass:result.networkClass});
}
export async function executeProviderGenerationExecution(argv:readonly string[],deps:ExecutionDependencies={}){
  // Established bounded lifecycle facts survive every later entrypoint failure.
  const lifecycle:Lifecycle={identityVerified:false,harnessInvocationCount:0,latestHarnessProjection:null,
    projectionEmissionAttemptCount:0,projectionEmissionSucceeded:false};
  const writer=deps.writeProjection??((value:string)=>process.stdout.write(`${value}\n`));
  // Exactly one projection write is attempted; writer failure never triggers fallback emission.
  const finish=(projection:EntrypointProjection,exitCode:number)=>{
    lifecycle.projectionEmissionAttemptCount+=1;
    try{writer(JSON.stringify(projection));lifecycle.projectionEmissionSucceeded=true;
      return {exitCode,projection,lifecycle:Object.freeze({...lifecycle})};}
    catch{return {exitCode:5,projection:projectionOf(lifecycle,'BLOCKED','UNEXPECTED_ENTRYPOINT_FAILURE'),
      lifecycle:Object.freeze({...lifecycle})};}
  };
  let input:Invocation;
  try{input=parseProviderGenerationExecutionInvocation(argv);}
  catch{return finish(projectionOf(lifecycle,'BLOCKED','INVALID_INVOCATION'),4);}
  const fileSystem=deps.fileSystem??new NodeOllamaPreflightFileSystem();
  // Identity must pass before any preflight or harness invocation.
  try{assertOllamaExecutableIdentity(approved(input),input.executableRealpath,fileSystem);
    lifecycle.identityVerified=true;}
  catch{return finish(projectionOf(lifecycle,'BLOCKED','EXECUTABLE_IDENTITY_MISMATCH'),3);}
  try{
    const harness=deps.executeHarness??executeProviderGenerationValidation;
    const runPreflight=deps.runPreflight??((phase:'PRE'|'POST')=>concretePreflight(phase,input,deps,fileSystem));
    const harnessDependencies:ProviderGenerationValidationDependencies={runPreflight:(phase)=>runPreflight(phase,input),
      verifyModelAcquisitionDenied:deps.verifyModelAcquisitionDenied};
    lifecycle.harnessInvocationCount+=1;
    lifecycle.latestHarnessProjection=await harness({executableRealpath:input.executableRealpath,
      approvedLoopbackEndpoint:input.approvedLoopbackEndpoint,
      modelAcquisitionControl:input.modelAcquisitionControl},harnessDependencies);
    const p=lifecycle.latestHarnessProjection;
    const failureCode = boundedHarnessFailureCode(p.failureCode);
    const status = failureCode === 'UNEXPECTED_ENTRYPOINT_FAILURE' ? 'BLOCKED' : p.status;
    return finish(projectionOf(lifecycle,status,failureCode),status==='PASS'?0:status==='FAIL'?2:3);
  }catch{return finish(projectionOf(lifecycle,'BLOCKED','UNEXPECTED_ENTRYPOINT_FAILURE'),5);}
}
if(require.main===module)void executeProviderGenerationExecution(process.argv.slice(2)).then(({exitCode})=>{
  process.exitCode=exitCode;
});
