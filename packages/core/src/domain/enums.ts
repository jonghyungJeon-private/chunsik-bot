/**
 * Domain enumerations. These are stable, framework-agnostic value types.
 * Nothing here may reference a concrete provider, Discord, or SQLite.
 */

/** Lifecycle of a unit of work. See the task model in the architecture docs. */
export enum TaskStatus {
  PENDING = 'PENDING',
  PLANNING = 'PLANNING',
  WAITING_APPROVAL = 'WAITING_APPROVAL',
  RUNNING = 'RUNNING',
  TESTING = 'TESTING',
  FAILED = 'FAILED',
  CANCELED = 'CANCELED',
  COMPLETED = 'COMPLETED',
  NEEDS_REVIEW = 'NEEDS_REVIEW',
}

/** Status of a single execution attempt of a task. */
export enum TaskRunStatus {
  STARTED = 'STARTED',
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
  CANCELED = 'CANCELED',
}

/**
 * Risk drives the approval gate.
 * LOW/MEDIUM may run automatically; HIGH/CRITICAL require explicit approval.
 */
export enum RiskLevel {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

/**
 * Capabilities are ABOVE models. The user asks for an outcome; the core maps
 * the intent to a capability, and the router selects whichever AiProvider can
 * serve that capability best. No capability is tied to a concrete CLI here.
 */
export enum Capability {
  GENERAL_CHAT = 'GENERAL_CHAT',
  SUMMARIZATION = 'SUMMARIZATION',
  DOCUMENT_ANALYSIS = 'DOCUMENT_ANALYSIS',
  CODE_IMPLEMENTATION = 'CODE_IMPLEMENTATION',
  CODE_REVIEW = 'CODE_REVIEW',
  ARCHITECTURE_PLANNING = 'ARCHITECTURE_PLANNING',
  TEST_EXECUTION = 'TEST_EXECUTION',
  READONLY_LOOKUP = 'READONLY_LOOKUP',
  EMBEDDING = 'EMBEDDING',
}

/** What the user is (probably) trying to do, before it becomes a Capability. */
export enum IntentType {
  CHAT = 'CHAT',
  SUMMARIZE = 'SUMMARIZE',
  ANALYZE_DOCUMENT = 'ANALYZE_DOCUMENT',
  IMPLEMENT_CODE = 'IMPLEMENT_CODE',
  REVIEW_CODE = 'REVIEW_CODE',
  PLAN_ARCHITECTURE = 'PLAN_ARCHITECTURE',
  RUN_TESTS = 'RUN_TESTS',
  LOOKUP = 'LOOKUP',
  UNKNOWN = 'UNKNOWN',
}

/** Chunsik Memory is the source of truth — never the CLI's internal memory. */
export enum MemoryType {
  SHORT_TERM = 'SHORT_TERM',
  WORKING = 'WORKING',
  LONG_TERM = 'LONG_TERM',
  PROJECT = 'PROJECT',
  TOOL = 'TOOL',
  CONNECTOR = 'CONNECTOR',
}

/** AI outputs are first-class artifacts, not plain text. */
export enum ArtifactKind {
  MARKDOWN_REPORT = 'MARKDOWN_REPORT',
  CODE_DIFF = 'CODE_DIFF',
  PATCH = 'PATCH',
  TEST_LOG = 'TEST_LOG',
  JIRA_REPORT = 'JIRA_REPORT',
  SLACK_SUMMARY = 'SLACK_SUMMARY',
  CONFLUENCE_DRAFT = 'CONFLUENCE_DRAFT',
  DOCUMENT_SUMMARY = 'DOCUMENT_SUMMARY',
}
