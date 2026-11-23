export interface DshClientPluginEntry {
  id: string
  name: string
  version: string
  apiVersion: 1
  entry: string
  styles: string[]
  rev: string
  entryUrl: string
  styleUrls: string[]
}

export interface DshClientPluginProblem {
  id: string
  name: string
  reason: string
}

export interface DshClientPluginList {
  entries: DshClientPluginEntry[]
  problems: DshClientPluginProblem[]
  registryProblem?: string
}

export type DshPluginRpcResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } }

export interface DshPluginRpcEventPayload {
  pluginId: string
  event: string
  payload: unknown
}
