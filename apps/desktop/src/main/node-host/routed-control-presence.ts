import type { AgentEvent, HarnessId } from '@superone/shared/agent-types'
import type { ControlLease, ProjectSnapshot, SessionRef, TerminalRef } from '@superone/shared/environment'
import type { EnvironmentRpcClient } from '../environment/environment-rpc-client'

type Metadata = Omit<Extract<AgentEvent, { type: 'session_control_changed' }>, 'lease'>
type Entry = { resource: SessionRef; lease: ControlLease | null; metadata?: Metadata; pending?: Promise<void> }
type Target = { client: Pick<EnvironmentRpcClient, 'rpc'>; projectKey(path: string): string }

/** Window presence for phone delegates on a node, fenced across asynchronous metadata reads. */
export class RoutedControlPresence {
  private readonly entries = new Map<string, Entry>()
  constructor(private readonly resolve: (environmentId: string) => Promise<Target> | Target,
    private readonly publish: (event: AgentEvent) => void,
    private readonly failed: (error: unknown) => void) {}

  changed(resource: SessionRef | TerminalRef, lease: ControlLease | null): void {
    if (!('sessionId' in resource)) return
    const key = JSON.stringify([resource.environmentId, resource.sessionId])
    let entry = this.entries.get(key)
    if (!entry) {
      if (!lease) return
      entry = { resource, lease }
      this.entries.set(key, entry)
    }
    entry.lease = lease
    if (entry.metadata) {
      this.publish({ ...entry.metadata, lease })
      if (!lease) this.entries.delete(key)
      return
    }
    if (entry.pending) return
    const current = entry
    current.pending = this.metadata(resource).then(metadata => {
      if (this.entries.get(key) !== current) return
      current.metadata = metadata
      this.publish({ ...metadata, lease: current.lease })
      if (!current.lease) this.entries.delete(key)
    }).catch(this.failed).finally(() => { current.pending = undefined })
  }

  private async metadata(resource: SessionRef): Promise<Metadata> {
    const target = await this.resolve(resource.environmentId)
    const [session, projects] = await Promise.all([
      target.client.rpc<{ sessionId: string; projectId: string; harnessId: HarnessId; acpAgentId?: string | null; cwd?: string | null } | null>(
        'session.get', { sessionId: resource.sessionId, includeTranscript: false }, resource.environmentId),
      target.client.rpc<ProjectSnapshot[]>('project.list', {}, resource.environmentId),
    ])
    const project = projects.find(item => item.projectId === session?.projectId)
    if (!session || session.sessionId !== resource.sessionId || !project) throw new Error('Routed control metadata is unavailable')
    return { type: 'session_control_changed', sessionId: resource.sessionId, projectPath: target.projectKey(project.path),
      harnessId: session.harnessId, acpAgentId: session.acpAgentId,
      worktreePath: session.cwd && session.cwd !== project.path ? session.cwd : null }
  }
}
