import type { ControlLease, EnvironmentLiveStatus, EnvironmentUsageReport, ExecutionEnvironmentDescriptor, TerminalReadResult, TopicSubscribeInput } from '@superone/shared/environment'
import type { RpcStreamHandlers } from '@superone/shared/environment/rpc-connection'
import type { DetailUpdate } from '@superone/shared/environment/detail'
import type { TopicRef } from '@superone/shared/environment/topics'

export interface TopicStream {
  close(): void
  update(topics: TopicRef[]): Promise<void>
}

/** Resource methods shared by network and in-process callers of the domain. */
export abstract class EnvironmentRpcClient {
  onControlLost(_listener: (event: import('@superone/shared/environment').ControlLostEvent) => void): () => void { return () => {} }
  abstract rpc<T = unknown>(method: string, payload?: unknown, environmentId?: string, commandKey?: string): Promise<T>
  abstract getDescriptor(): Promise<ExecutionEnvironmentDescriptor>
  abstract readonly tier: 'relay' | 'lan'
  abstract subscribeEvents(input: Omit<TopicSubscribeInput, 'subscriptionId'>, handlers: RpcStreamHandlers): Promise<TopicStream>
  abstract subscribeDetail(input: { sessionId: string; detailRef: string; subscriptionId: string }, onUpdate: (update: DetailUpdate) => void): Promise<DetailUpdate>
  abstract unsubscribeDetail(input: { sessionId: string; subscriptionId: string }): Promise<void>

  async health(): Promise<{ ok: boolean; environmentId: string; uptimeMs: number }> {
    return this.rpc('environment.health')
  }

  async systemInfo(): Promise<Record<string, unknown>> {
    return this.rpc('environment.systemInfo')
  }

  async liveStatus(): Promise<EnvironmentLiveStatus> {
    return this.rpc('environment.status')
  }

  async usage(): Promise<EnvironmentUsageReport> {
    return this.rpc('environment.usage')
  }

  async terminalCreate(input: {
    cwd: string
    title?: string
    cols?: number
    rows?: number
  }): Promise<{ terminalId: string }> {
    return this.rpc('terminal.create', input)
  }

  async terminalAttach(terminalId: string): Promise<{ snapshot: string; sequence: string }> {
    return this.rpc('terminal.attach', { terminalId })
  }

  async terminalRead(terminalId: string, afterSequence: string): Promise<TerminalReadResult> {
    return this.rpc('terminal.read', { terminalId, afterSequence })
  }

  async terminalWrite(terminalId: string, data: string, leaseId: string, generation: string): Promise<void> {
    await this.rpc('terminal.write', { terminalId, data, leaseId, generation })
  }

  async terminalResize(
    terminalId: string,
    cols: number,
    rows: number,
    leaseId: string,
    generation: string,
  ): Promise<void> {
    await this.rpc('terminal.resize', { terminalId, cols, rows, leaseId, generation })
  }

  async terminalKill(terminalId: string, leaseId: string, generation: string): Promise<void> {
    await this.rpc('terminal.kill', { terminalId, leaseId, generation })
  }

  async terminalAcquireControl(terminalId: string, ttlMs?: number, control?: { delegate?: string; yields?: boolean }): Promise<ControlLease> {
    return this.rpc<ControlLease>('terminal.acquireControl', { terminalId, ttlMs, ...control })
  }

}
