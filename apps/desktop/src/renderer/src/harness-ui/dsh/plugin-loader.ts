import type { ClientKernel, KernelScope } from '@superone/client-kernel'
import type { SlotRegistry } from '@superone/ui-slots'
import {
  PLUGIN_SDK_API_VERSION,
  createSlotRegistrar,
  type SuperoneClientPluginActivate,
  type SuperoneClientPluginContext,
} from '@superone/plugin-sdk'
import type { DshClientPluginEntry, DshClientPluginList } from '@superone/shared/dsh-plugin-client'
import { closeGhostPluginPanels, closePluginPanelTab, openPluginPanelTab } from '@/components/activity/activity-panel-api'
import { getAppClientKernel } from '@/lib/client-kernel'
import { useAppStore } from '@/stores/app'
import { createIsolatedDshKernelScope } from './dsh-isolation'

export interface DshPluginHostApi {
  listClientPlugins(): Promise<DshClientPluginList>
  invoke<T = unknown>(pluginId: string, method: string, payload?: unknown): Promise<{ ok: true; data: T } | { ok: false; error: { code: string; message: string } }>
  on(pluginId: string, event: string, callback: (payload: unknown) => void): () => void
  onPluginsChanged(callback: () => void): () => void
}

export interface DshClientPluginManagerOptions {
  api?: DshPluginHostApi
  kernel?: ClientKernel
  registry?: SlotRegistry
  isGlobalShellAllowed?: () => boolean
  ensureShared?: () => Promise<unknown>
  importModule?: (url: string) => Promise<Record<string, unknown>>
  attachStylesheet?: (pluginId: string, href: string) => () => void
  closeGhostPanels?: (isAlive: (panelKey: string) => boolean) => void
  onError?: (pluginId: string, error: unknown) => void
}

interface MountedPlugin {
  rev: string
  scope: KernelScope
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
  private readonly kernel: ClientKernel | null
  private readonly registry: SlotRegistry
  private readonly isGlobalShellAllowed: () => boolean
  private readonly ensureShared: () => Promise<unknown>
  private readonly importModule: (url: string) => Promise<Record<string, unknown>>
  private readonly attachStylesheet: (pluginId: string, href: string) => () => void
  private readonly closeGhostPanels: (isAlive: (panelKey: string) => boolean) => void
  private readonly onError: (pluginId: string, error: unknown) => void
  private unsubChanged: (() => void) | null = null
  private reconcileQueue: Promise<void> = Promise.resolve()

  constructor(options: DshClientPluginManagerOptions = {}) {
    this.api = options.api ?? window.superonePlugin
    this.kernel = options.kernel ?? (options.registry ? null : getAppClientKernel())
    this.registry = options.registry ?? this.kernel!.slots
    this.isGlobalShellAllowed = options.isGlobalShellAllowed ?? (() => useAppStore.getState().experimentalDshGlobalShell === true)
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

      const baseScope: KernelScope = this.kernel
        ? this.kernel.createScope()
        : (() => {
            const slotScope = this.registry.createScope()
            let disposed = false
            const noopDisposer = Object.assign(() => {}, { dispose: () => {}, [Symbol.dispose]: () => {} })
            const disposeFn = () => {
              disposed = true
              slotScope.dispose()
            }
            const fallbackScope: KernelScope = {
              get disposed() {
                return disposed
              },
              slots: slotScope,
              registerCommand: () => noopDisposer,
              registerCommandMiddleware: () => noopDisposer,
              registerKeybinding: () => noopDisposer,
              registerMenuItem: () => noopDisposer,
              registerThemeLayer: () => noopDisposer,
              createChildScope: () => fallbackScope,
              onDispose: (fn) => slotScope.onDispose(fn),
              dispose: disposeFn,
              [Symbol.dispose]: disposeFn,
            }
            return fallbackScope
          })()
      const scope = createIsolatedDshKernelScope(baseScope, {
        isGlobalShellAllowed: this.isGlobalShellAllowed,
        pluginId: entry.id,
      })
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

        const fallbackLayoutResult = (code: 'unsupported' | 'error', message: string) => ({
          ok: false as const,
          ...(code === 'unsupported' ? { unsupported: true } : {}),
          code,
          message,
        })

        const ctx: SuperoneClientPluginContext = {
          apiVersion: PLUGIN_SDK_API_VERSION,
          pluginId: entry.id,
          scope: scope.slots,
          slots: createSlotRegistrar(scope.slots),
          commands: {
            registerCommand: (def) => scope.registerCommand(def),
            registerMiddleware: (commandId, mw, priority) => scope.registerCommandMiddleware(commandId, mw, priority),
            executeCommand: <Result = unknown>(id: string, ...args: unknown[]) =>
              this.kernel
                ? this.kernel.commands.executeCommand<Result>(id, ...args)
                : Promise.reject(new Error(`Kernel unavailable to execute "${id}"`)),
          },
          keybindings: {
            registerKeybinding: (def) => scope.registerKeybinding(def),
          },
          menus: {
            registerMenuItem: (menuId, item) => scope.registerMenuItem(menuId, item),
          },
          layout: {
            openPanel: (req) =>
              this.kernel
                ? this.kernel.layout.openPanel({ ...req, params: { ...req.params, pluginId: entry.id } })
                : Promise.resolve(fallbackLayoutResult('unsupported', 'Layout bus unavailable')),
            closePanel: (panelIdOrKey) =>
              this.kernel
                ? this.kernel.layout.closePanel(panelIdOrKey)
                : Promise.resolve(fallbackLayoutResult('unsupported', 'Layout bus unavailable')),
            focusPanel: (panelIdOrKey) =>
              this.kernel
                ? this.kernel.layout.focusPanel(panelIdOrKey)
                : Promise.resolve(fallbackLayoutResult('unsupported', 'Layout bus unavailable')),
            toggleSidebar: (open) =>
              this.kernel
                ? this.kernel.layout.toggleSidebar(open)
                : Promise.resolve(fallbackLayoutResult('unsupported', 'Layout bus unavailable')),
            toggleActivityPanel: (open) =>
              this.kernel
                ? this.kernel.layout.toggleActivityPanel(open)
                : Promise.resolve(fallbackLayoutResult('unsupported', 'Layout bus unavailable')),
            setChatMode: (mode) =>
              this.kernel
                ? this.kernel.layout.setChatMode(mode)
                : Promise.resolve(fallbackLayoutResult('unsupported', 'Layout bus unavailable')),
          },
          theme: {
            registerLayer: (layer) => scope.registerThemeLayer(layer),
          },
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
            openPanel: (panelKey: string, title: string, params?: Record<string, unknown>) => {
              if (this.kernel) {
                void this.kernel.layout.openPanel({ panelKey, title, params: { ...params, pluginId: entry.id } })
                return
              }
              openPluginPanelTab(panelKey, title, { ...params, pluginId: entry.id })
            },
            closePanel: (panelKey: string) => {
              if (this.kernel) {
                void this.kernel.layout.closePanel(panelKey)
                return
              }
              closePluginPanelTab(panelKey)
            },
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
