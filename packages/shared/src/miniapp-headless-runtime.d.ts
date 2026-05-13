import type { MessagePort } from 'node:worker_threads'

export interface KvPendingEntry {
  resolve: (value: unknown) => void
  reject: (err: Error) => void
}

export interface CreateSuperoneHeadlessOptions {
  appId: string
  sessionId: string
  parentPort: MessagePort
  handlers: Map<string, (args: Record<string, unknown>) => unknown | Promise<unknown>>
  kvPending: Map<string, KvPendingEntry>
}

export interface SuperoneHeadlessTools {
  handle(name: string, callback: (args: Record<string, unknown>) => unknown | Promise<unknown>): void
}

export interface SuperoneHeadlessPeer {
  emit(event: string, payload?: unknown): void
}

export interface SuperoneHeadlessKv {
  get<T = unknown>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
  list(prefix?: string): Promise<string[]>
}

export interface SuperoneHeadless {
  appId: string
  sessionId: string
  tools: SuperoneHeadlessTools
  peer: SuperoneHeadlessPeer
  kv: SuperoneHeadlessKv
}

export function createSuperoneHeadless(opts: CreateSuperoneHeadlessOptions): SuperoneHeadless

declare global {
  var superone: SuperoneHeadless
}
