import type {
  EnvironmentGateway,
  ProjectRef,
  WorkspaceDeleteInput,
  WorkspaceEntry,
  WorkspaceListInput,
  WorkspaceMkdirInput,
  WorkspaceMoveInput,
  WorkspaceReadInput,
  WorkspaceRenameInput,
  WorkspaceSearchInput,
  WorkspaceWriteInput,
} from '@superone/shared/environment'

/**
 * Routes workspace FS operations through the environment gateway selected by
 * ProjectRef.environmentId. Desktop local FS APIs must never receive remote paths.
 */
export class WorkspaceRouter {
  constructor(
    private readonly getGateway: (environmentId: string) => EnvironmentGateway | null,
    /**
     * Optional spy hook used in tests to prove local FS is not called for remote refs.
     * Production leaves this undefined.
     */
    private readonly localFsProbe?: {
      listDir?: (absoluteProjectPath: string, relativePath: string) => Promise<WorkspaceEntry[]>
      readFile?: (absoluteProjectPath: string, relativePath: string) => Promise<{ content: string }>
    },
  ) {}

  async listDir(input: WorkspaceListInput): Promise<WorkspaceEntry[]> {
    const gw = this.requireGateway(input.project)
    // Never call local FS probe for remote-backed gateways.
    if (this.isLocalGateway(gw) && this.localFsProbe?.listDir) {
      // Local path handling is out of band; tests assert remote never hits this.
      throw new Error('local FS probe must not be used via WorkspaceRouter for remote projects')
    }
    return gw.workspace.listDir(input)
  }

  async readFile(input: WorkspaceReadInput): Promise<{ content: string | Uint8Array; hash?: string }> {
    const gw = this.requireGateway(input.project)
    if (this.isLocalGateway(gw) && this.localFsProbe?.readFile) {
      throw new Error('local FS probe must not be used via WorkspaceRouter for remote projects')
    }
    return gw.workspace.readFile(input)
  }

  async writeFile(input: WorkspaceWriteInput): Promise<{ hash?: string }> {
    const gw = this.requireGateway(input.project)
    return gw.workspace.writeFile(input)
  }

  async search(input: WorkspaceSearchInput): Promise<Array<{ path: string; line?: number; preview?: string }>> {
    const gw = this.requireGateway(input.project)
    return gw.workspace.search(input)
  }

  async rename(input: WorkspaceRenameInput): Promise<{ from: string; to: string }> {
    const gw = this.requireGateway(input.project)
    return gw.workspace.rename(input)
  }

  async move(input: WorkspaceMoveInput): Promise<{ from: string; to: string }> {
    const gw = this.requireGateway(input.project)
    return gw.workspace.move(input)
  }

  async delete(input: WorkspaceDeleteInput): Promise<{ path: string }> {
    const gw = this.requireGateway(input.project)
    return gw.workspace.delete(input)
  }

  async mkdir(input: WorkspaceMkdirInput): Promise<{ path: string }> {
    const gw = this.requireGateway(input.project)
    return gw.workspace.mkdir(input)
  }

  private requireGateway(project: ProjectRef): EnvironmentGateway {
    const gw = this.getGateway(project.environmentId)
    if (!gw) {
      throw Object.assign(new Error(`unknown environment: ${project.environmentId}`), {
        code: 'not_found',
      })
    }
    return gw
  }

  private isLocalGateway(gw: EnvironmentGateway): boolean {
    // LocalEnvironmentGateway is the only in-process gateway; remotes use RPC.
    return gw.constructor.name === 'LocalEnvironmentGateway'
  }
}
