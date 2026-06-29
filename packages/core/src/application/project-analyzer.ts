import type { ProjectReadout, StorageProvider } from '../ports';
import type { Session } from '../domain';
import type { WorkspaceManager } from './workspace-manager';

export interface AnalysisPreparation {
  /** Whether analysis can proceed (an active, resolvable project exists). */
  ready: boolean;
  /** Friendly guidance when not ready (e.g. no project registered). */
  message?: string;
  /** The read-only project readout to feed the prompt, when ready. */
  readout?: ProjectReadout;
}

/**
 * Prepares a gated project analysis (ADR-0019): guards that the session has a
 * registered active project, then performs a read-only, size-limited read of an
 * allow-listed file set. The AI summarization itself runs in the normal task
 * pipeline; this service only does the deterministic guard + gather.
 */
export class ProjectAnalyzer {
  constructor(
    private readonly storage: StorageProvider,
    private readonly workspace: WorkspaceManager,
  ) {}

  async prepare(session: Session): Promise<AnalysisPreparation> {
    if (!session.activeProjectId) {
      return {
        ready: false,
        message: '먼저 프로젝트를 등록해주세요. 예: "이 프로젝트 등록해줘: /path/to/repo" 🐹',
      };
    }
    const project = await this.storage.projects.get(session.activeProjectId);
    if (!project) {
      return { ready: false, message: '활성 프로젝트를 찾을 수 없어요. 다시 등록해 주세요.' };
    }
    const readout = await this.workspace.readProjectFiles(project.rootPath);
    return { ready: true, readout };
  }
}
