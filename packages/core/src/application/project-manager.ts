import { newId } from '../util/id';
import { now } from '../util/clock';
import type { Project, Session } from '../domain';
import type { ProjectScan, StorageProvider } from '../ports';
import type { WorkspaceManager } from './workspace-manager';
import type { MemoryManager } from './memory-manager';
import type { SessionManager } from './session-manager';

export interface ProjectRegistrationResult {
  ok: boolean;
  /** User-facing reply (success or a friendly failure). */
  message: string;
  project?: Project;
}

/**
 * Registers a LOCAL project from a natural-language request (ADR-0018). Read-only:
 * it scans the directory, persists a Project, stores a PROJECT memory summary, and
 * binds the project to the session as active. No code is modified; not a git repo →
 * branch is 'unknown'.
 */
export class ProjectManager {
  constructor(
    private readonly storage: StorageProvider,
    private readonly workspace: WorkspaceManager,
    private readonly memory: MemoryManager,
    private readonly sessions: SessionManager,
  ) {}

  async register(path: string, session: Session): Promise<ProjectRegistrationResult> {
    const target = path.trim();
    if (!target) {
      return {
        ok: false,
        message: '등록할 로컬 경로를 찾지 못했어요. 예: "이 프로젝트 등록해줘: /path/to/repo"',
      };
    }

    const scan = await this.workspace.scan(target);
    if (!scan.exists) {
      return {
        ok: false,
        message: `경로를 찾을 수 없어요: ${target}\n로컬 디렉터리의 절대경로인지 확인해 주세요.`,
      };
    }

    const project: Project = {
      id: newId(),
      name: scan.name,
      rootPath: scan.rootPath,
      createdAt: now(),
    };
    await this.storage.projects.save(project);
    await this.memory.recordProjectMemory(this.renderSummary(scan), {
      projectId: project.id,
      sessionId: session.id,
    });
    await this.sessions.setActiveProject(session, project.id);

    return {
      ok: true,
      project,
      message:
        `✅ 프로젝트 "${scan.name}" 등록 완료!\n` +
        `- 경로: ${scan.rootPath}\n` +
        `- git branch: ${scan.gitBranch}\n` +
        `- 패키지 매니저: ${scan.packageManager}\n` +
        '이제 이 프로젝트 맥락으로 질문할 수 있어요. 🐹',
    };
  }

  /** The PROJECT memory body stored for the registered project. */
  private renderSummary(scan: ProjectScan): string {
    return [
      `# Project: ${scan.name}`,
      `- path: ${scan.rootPath}`,
      `- git branch: ${scan.gitBranch}`,
      `- package manager: ${scan.packageManager}`,
      '',
      '## File tree (top-level, read-only)',
      scan.fileTreeSummary,
    ].join('\n');
  }
}
