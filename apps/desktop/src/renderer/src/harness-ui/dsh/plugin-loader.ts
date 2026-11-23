import type { SlotRegistry, SlotScopeHandle } from '@superone/ui-slots'
import {
  PLUGIN_SDK_API_VERSION,
  createSlotRegistrar,
  type SuperoneClientPluginActivate,
  type SuperoneClientPluginContext,
} from '@superone/plugin-sdk'
import type { DshClientPluginEntry, DshClientPluginList } from '@superone/shared/dsh-plugin-client'
import { closeGhostPluginPanels, closePluginPanelTab, openPluginPanelTab } from '@/components/activity/activity-panel-api'
import { getAppSlotRegistry } from '@/lib/ui-slots'

export interface DshPluginHostApi {
  listClientPlugins(): Promise<DshClientPluginList>
  invoke<T = unknown>(pluginId: string, method: string, payload?: unknown): Promise<{ ok: true; data: T } | { ok: false; error: { code: string; message: string } }>
  on(pluginId: string, event: string, callback: (payload: unknown) => void): () => void
  onPluginsChanged(callback: () => void): () => void
}

export interface DshClientPluginManagerOptions {
  api?: DshPluginHostApi
  registry?: SlotRegistry
  ensureShared?: () => Promise<unknown>
  importModule?: (url: string) => Promise<Record<string, unknown>>
  attachStylesheet?: (pluginId: string, href: string) => () => void
  closeGhostPanels?: (isAlive: (panelKey: string) => boolean) => void
  onError?: (pluginId: string, error: unknown) => void
}

interface MountedPlugin {
  rev: string
  scope: SlotScopeHandle
}

function defaultAttachStylesheet(pluginId: string, href: string): () => void {
  if (typeof document === 'undefined' || !document.head) return () => {}
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = href
  link.crossOrigin = 'anonymous'
  link.dataset.superonePlugin = pluginId
  document.head.appendChild(link)
  return () => {
    link.remove()
  }
}

function defaultImportModule(url: string): Promise<Record<string, unknown>> {
  return import(/* @vite-ignore */ url) as Promise<Record<string, unknown>>
}

function extractActivate(mod: Record<string, unknown>): SuperoneClientPluginActivate | null {
  const candidate = mod.default ?? mod
  if (typeof candidate === 'function') return candidate as SuperoneClientPluginActivate
  if (candidate && typeof candidate === 'object' && typeof (candidate as { activate?: unknown }).activate === 'function') {
    return (candidate as { activate: SuperoneClientPluginActivate }).activate
  }
  if (typeof mod.activate === 'function') return mod.activate as SuperoneClientPluginActivate
  return null
}

export class DshClientPluginManager {
  private readonly mounted = new Map<string, MountedPlugin>()
  private readonly api: DshPluginHostApi
  private readonly registry: SlotRegistry
  private readonly ensureShared: () => Promise<unknown>
  private readonly importModule: (url: string) => Promise<Record<string, unknown>>
  private readonly attachStylesheet: (pluginId: string, href: string) => () => void
  private readonly closeGhostPanels: (isAlive: (panelKey: string) => boolean) => void
  private readonly onError: (pluginId: string, error: unknown) => void
  private unsubChanged: (() => void) | null = null
  private reconcileQueue: Promise<void> = Promise.resolve()

  constructor(options: DshClientPluginManagerOptions = {}) {
    this.api = options.api ?? window.superonePlugin
    this.registry = options.registry ?? getAppSlotRegistry()
    this.ensureShared = options.ensureShared ?? (async () => (await import('./shared-runtime')).ensureSuperoneShared())
    this.importModule = options.importModule ?? defaultImportModule
    this.attachStylesheet = options.attachStylesheet ?? defaultAttachStylesheet
    this.closeGhostPanels = options.closeGhostPanels ?? closeGhostPluginPanels
    this.onError = options.onError ?? ((id, err) => console.error(`[dsh-ui-plugin] ${id}`, err))
  }

  start(): () => void {
    this.unsubChanged?.()
    this.unsubChanged = this.api.onPluginsChanged(() => {
      void this.reconcile()
    })
    void this.reconcile()
    return () => {
      this.dispose()
    }
  }

  reconcile(): Promise<void> {
    const run = this.reconcileQueue.then(() => this.runReconcile())
    this.reconcileQueue = run.catch(() => {})
    return run
  }

  private async runReconcile(): Promise<void> {
    const list = await this.api.listClientPlugins()
    const desired = new Map<string, DshClientPluginEntry>(list.entries.map((e) => [e.id, e]))

    let disposedAny = false
    for (const [id, current] of [...this.mounted]) {
      const next = desired.get(id)
      if (!next || next.rev !== current.rev) {
        this.mounted.delete(id)
        current.scope.dispose()
        disposedAny = true
      }
    }

    if (desired.size === 0) {
      if (disposedAny) {
        this.closeGhostPanels((panelKey) => this.registry.hasKeyed('activity.panel', panelKey))
      }
      return
    }

    await this.ensureShared()

    for (const entry of desired.values()) {
      const existing = this.mounted.get(entry.id)
      if (existing && existing.rev === entry.rev) continue

      const scope = this.registry.createScope()
      try {
        for (const styleUrl of entry.styleUrls) {
          scope.onDispose(this.attachStylesheet(entry.id, styleUrl))
        }
        const mod = await this.importModule(entry.entryUrl)
        const activate = extractActivate(mod)
        if (!activate) {
          throw new Error(`Client plugin ${entry.id} exports no activate function`)
        }
        const rpcUnsubscribers = new Set<() => void>()
        scope.onDispose(() => {
          for (const unsub of [...rpcUnsubscribers]) unsub()
          rpcUnsubscribers.clear()
        })

        const ctx: SuperoneClientPluginContext = {
          apiVersion: PLUGIN_SDK_API_VERSION,
          pluginId: entry.id,
          scope,
          slots: createSlotRegistrar(scope),
          rpc: {
            invoke: <T = unknown>(method: string, payload?: unknown) =>
              this.api.invoke<T>(entry.id, method, payload),
            on: (event: string, callback: (payload: unknown) => void) => {
              const unsub = this.api.on(entry.id, event, callback)
              rpcUnsubscribers.add(unsub)
              return () => {
                rpcUnsubscribers.delete(unsub)
                unsub()
              }
            },
          },
          activity: {
            openPanel: (panelKey: string, title: string, params?: Record<string, unknown>) =>
              openPluginPanelTab(panelKey, title, { ...params, pluginId: entry.id }),
            closePanel: (panelKey: string) => closePluginPanelTab(panelKey),
          },
          onDispose: (fn: () => void) => scope.onDispose(fn),
        }

        const cleanup = await activate(ctx)
        if (typeof cleanup === 'function') {
          scope.onDispose(cleanup)
        }
        this.mounted.set(entry.id, { rev: entry.rev, scope })
      } catch (error) {
        scope.dispose()
        this.onError(entry.id, error)
      }
    }

    if (disposedAny) {
      this.closeGhostPanels((panelKey) => this.registry.hasKeyed('activity.panel', panelKey))
    }
  }

  getMountedIds(): string[] {
    return [...this.mounted.keys()]
  }

  dispose(): void {
    this.unsubChanged?.()
    this.unsubChanged = null
    for (const [, current] of [...this.mounted]) {
      current.scope.dispose()
    }
    this.mounted.clear()
    this.closeGhostPanels((panelKey) => this.registry.hasKeyed('activity.panel', panelKey))
  }
}

export function startDshPluginLoader(options?: DshClientPluginManagerOptions): () => void {
  const manager = new DshClientPluginManager(options)
  return manager.start()
}
