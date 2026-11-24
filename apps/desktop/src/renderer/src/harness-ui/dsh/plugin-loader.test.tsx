/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { execFileSync } from 'node:child_process'
import { cp, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { HARNESS_CAPABILITIES } from '@superone/shared/harness/harness-capabilities'
import { createSlotRegistry } from '@superone/ui-slots'
import { SlotRegistryProvider, SlotScopeProvider } from '@superone/ui-slots/react'
import {
  DeepseekPlugins,
  createDeepseekTree,
  installPluginFromDirectory,
  readClientPluginEntries,
  setPluginDisabled,
} from '@superone/deepseek'
import { createPluginProtocolHandler } from '../../../../main/deepseek/plugin-protocol'
import { ToolBlockPresenter, type ToolBlockPresenterPorts } from '@/components/chat/ToolBlockPresenter'
import { PluginDockPanel } from '@/components/activity/PluginDockPanel'
import { closeGhostPluginPanels, pluginPanelId, setDockApi } from '@/components/activity/activity-panel-api'
import { DshClientPluginManager, type DshPluginHostApi } from './plugin-loader'
import { ensureSuperoneShared, resetSuperoneSharedForTest } from './shared-runtime'
import '@/lib/ui-slots'

const SAMPLE_PLUGIN_FIXTURE = resolve(
  __dirname,
  '../../../../../../../packages/deepseek/src/fixtures/sample-ui-plugin',
)
const PLUGIN_SDK_BUILD = resolve(
  __dirname,
  '../../../../../../../packages/plugin-sdk/src/build.ts',
)

function makeToolPorts(): ToolBlockPresenterPorts {
  return {
    cwd: '/repo',
    homedir: '/home/user',
    stallLevel: 'normal',
    renderBash: ({ command }) => <div data-testid="stock-bash">{command}</div>,
    renderFileChip: ({ title, filePath }) => <span>{title || filePath}</span>,
    renderFileDiff: () => <div />,
    renderArtifactLink: ({ label }) => <span>{label}</span>,
    renderCount: (value) => <span>{value}</span>,
    renderJson: (text) => <pre>{text}</pre>,
    renderQuestionPreview: () => <div />,
    renderExitPlanMode: () => <div />,
    renderSessionLinkScope: (children) => <>{children}</>,
    renderMiniAppTool: () => ({ handled: false, node: null }),
  }
}

let tempRoots: string[] = []

beforeEach(() => {
  resetSuperoneSharedForTest()
})

afterEach(async () => {
  cleanup()
  setDockApi(null)
  resetSuperoneSharedForTest()
  await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('dsh client UI plugin loader & Mosaic isolation', () => {
  it('keeps __SUPERONE_SHARED__ uninitialized when no client plugins are enabled', async () => {
    const registry = createSlotRegistry()
    const api: DshPluginHostApi = {
      listClientPlugins: vi.fn(async () => ({ entries: [], problems: [] })),
      invoke: vi.fn(),
      on: vi.fn(() => () => {}),
      onPluginsChanged: vi.fn(() => () => {}),
    }
    const ensureSharedSpy = vi.fn(ensureSuperoneShared)
    const manager = new DshClientPluginManager({ api, registry, ensureShared: ensureSharedSpy })

    await manager.reconcile()

    expect(ensureSharedSpy).not.toHaveBeenCalled()
    expect((globalThis as { __SUPERONE_SHARED__?: unknown }).__SUPERONE_SHARED__).toBeUndefined()
    manager.dispose()
  })

  it('initializes frozen __SUPERONE_SHARED__ without lucide-react or internal chat stores', async () => {
    const shared = await ensureSuperoneShared()

    expect(Object.isFrozen(shared)).toBe(true)
    expect(shared.react).toBeDefined()
    expect(shared['react-dom']).toBeDefined()
    expect(shared['react/jsx-runtime']).toBeDefined()
    expect(shared.zustand).toBeDefined()
    expect(shared['@superone/plugin-sdk']).toBeDefined()
    expect(shared['@superone/ui/components/ui/button']).toBeDefined()
    expect('lucide-react' in shared).toBe(false)
    expect('useChatStore' in shared).toBe(false)
  })

  it('runs sample plugin end-to-end across Mosaic dsh+claude panes, PluginDockPanel, RPC, and hot disable', async () => {
    const pluginRoot = await realpath(await mkdtemp(join(tmpdir(), 'dsh-e2e-plugins-')))
    const fixtureStage = await realpath(await mkdtemp(join(tmpdir(), 'dsh-e2e-fixture-')))
    tempRoots.push(pluginRoot, fixtureStage)

    await cp(SAMPLE_PLUGIN_FIXTURE, fixtureStage, { recursive: true })
    execFileSync(
      'bun',
      [
        '-e',
        `import { buildPluginClient } from ${JSON.stringify(PLUGIN_SDK_BUILD)}; const r = await buildPluginClient({ entrypoints: [${JSON.stringify(join(SAMPLE_PLUGIN_FIXTURE, 'src', 'client.tsx'))}], outdir: ${JSON.stringify(join(fixtureStage, 'dist'))} }); if (!r.success) { console.error(r.logs); process.exit(1); }`,
      ],
      { stdio: 'pipe', env: { ...process.env, NODE_ENV: 'production' } },
    )

    await installPluginFromDirectory(pluginRoot, fixtureStage, { trust: 'granted' })

    const tree = await createDeepseekTree({})
    const plugins = new DeepseekPlugins(tree, pluginRoot)
    const syncReport = await plugins.sync()
    expect(syncReport.outcomes[0]?.status).toBe('mounted')

    const protocolHandler = createPluginProtocolHandler(() => pluginRoot, {
      devRendererUrl: () => undefined,
    })

    const listeners = new Set<() => void>()
    const rpcEvents = new Set<(msg: { pluginId: string; event: string; payload: unknown }) => void>()
    const rpc = tree.get('pluginRpc')!
    const unsubRpc = rpc.subscribe((msg) => {
      for (const cb of rpcEvents) cb(msg)
    })

    const api: DshPluginHostApi = {
      listClientPlugins: () => readClientPluginEntries(pluginRoot),
      invoke: async (pluginId, method, payload) => {
        try {
          const data = await rpc.invoke(pluginId, method, payload)
          return { ok: true, data: data as never }
        } catch (error) {
          return { ok: false, error: { code: 'rpc_error', message: String(error) } }
        }
      },
      on: (pluginId, event, cb) => {
        const handler = (msg: { pluginId: string; event: string; payload: unknown }) => {
          if (msg.pluginId === pluginId && msg.event === event) cb(msg.payload)
        }
        rpcEvents.add(handler)
        return () => rpcEvents.delete(handler)
      },
      onPluginsChanged: (cb) => {
        listeners.add(cb)
        return () => listeners.delete(cb)
      },
    }

    const registry = createSlotRegistry()
    const manager = new DshClientPluginManager({
      api,
      registry,
      ensureShared: ensureSuperoneShared,
      importModule: async (url) => {
        const res = await protocolHandler(
          new Request(url, { headers: { origin: 'superone-renderer://app' } }),
        )
        expect(res.status).toBe(200)
        expect(res.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
        const diskPath = join(pluginRoot, 'node_modules', '@acme', 'dsh-sample-ui', 'dist', 'client.js')
        return (await import(/* @vite-ignore */ `${pathToFileURL(diskPath).href}?t=${Date.now()}`)) as Record<string, unknown>
      },
      closeGhostPanels: closeGhostPluginPanels,
    })

    const closeGhostDockPanel = vi.fn()
    setDockApi({
      panels: [
        {
          id: pluginPanelId('sample:inspector'),
          params: { panelKey: 'sample:inspector' },
          api: { close: closeGhostDockPanel },
        },
      ],
      activePanel: undefined,
    } as never)

    try {
      await act(async () => {
        manager.start()
        await new Promise((r) => setTimeout(r, 30))
      })
      await waitFor(() => {
        expect(manager.getMountedIds()).toEqual(['@acme/dsh-sample-ui'])
      })
      const styleLink = document.head.querySelector('link[data-superone-plugin="@acme/dsh-sample-ui"]')
      expect(styleLink).not.toBeNull()

      const ports = makeToolPorts()
      render(
        <SlotRegistryProvider registry={registry}>
          <div data-testid="mosaic-dsh-pane">
            <SlotScopeProvider active={HARNESS_CAPABILITIES.dsh.supportsUiPlugins} scope={{ sessionId: 's-dsh' }}>
              <ToolBlockPresenter
                toolName="sample_inspect"
                toolUseId="t-dsh"
                input="{}"
                status="complete"
                allowExpand
                autoExpandFileDiffs={false}
                ports={ports}
              />
            </SlotScopeProvider>
          </div>
          <div data-testid="mosaic-claude-pane">
            <SlotScopeProvider active={HARNESS_CAPABILITIES.claude.supportsUiPlugins} scope={{ sessionId: 's-claude' }}>
              <ToolBlockPresenter
                toolName="sample_inspect"
                toolUseId="t-claude"
                input="{}"
                status="complete"
                allowExpand
                autoExpandFileDiffs={false}
                ports={ports}
              />
            </SlotScopeProvider>
          </div>
          <div data-testid="dock-panel-host">
            <PluginDockPanel
              params={{ panelKey: 'sample:inspector', pluginId: '@acme/dsh-sample-ui' }}
              api={{ title: 'Sample Inspector' } as never}
              containerApi={{} as never}
            />
          </div>
        </SlotRegistryProvider>,
      )

      const dshPane = screen.getByTestId('mosaic-dsh-pane')
      const claudePane = screen.getByTestId('mosaic-claude-pane')

      expect(dshPane.querySelector('[data-testid="sample-dsh-tool-block"]')).not.toBeNull()
      expect(claudePane.querySelector('[data-testid="sample-dsh-tool-block"]')).toBeNull()
      expect(claudePane.textContent).toContain('sample inspect')

      await waitFor(() => {
        expect(dshPane.textContent).toContain('@acme/dsh-sample-ui')
      })

      expect(screen.getByTestId('sample-dsh-inspector-panel').textContent).toContain('Inspector:Sample Inspector')

      await setPluginDisabled(pluginRoot, '@acme/dsh-sample-ui', true)
      await plugins.sync()

      await act(async () => {
        for (const cb of listeners) cb()
        await new Promise((r) => setTimeout(r, 20))
      })

      expect(manager.getMountedIds()).toEqual([])
      expect(document.head.querySelector('link[data-superone-plugin="@acme/dsh-sample-ui"]')).toBeNull()
      expect(closeGhostDockPanel).toHaveBeenCalledOnce()
      expect(dshPane.querySelector('[data-testid="sample-dsh-tool-block"]')).toBeNull()
      expect(dshPane.textContent).toContain('sample inspect')
      expect(screen.getByText('Plugin panel unavailable')).toBeTruthy()
      expect(rpc.hasHandler('@acme/dsh-sample-ui', 'inspectTool')).toBe(false)
    } finally {
      unsubRpc()
      manager.dispose()
      await plugins.dispose()
      await tree.fiber.dispose()
    }
  })

  it('catches faulty plugin throw inside ToolBlockPresenter ErrorBoundary without crashing sibling panes', () => {
    const registry = createSlotRegistry()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    registry.registerChain('chat.toolBlock', {
      id: 'faulty-tool',
      priority: 100,
      match: (p) => p.toolName === 'custom_tool',
      render: () => {
        throw new Error('faulty plugin tool crash')
      },
    })

    const ports = makeToolPorts()
    render(
      <SlotRegistryProvider registry={registry}>
        <div data-testid="dsh-pane">
          <SlotScopeProvider active={true}>
            <ToolBlockPresenter
              toolName="custom_tool"
              toolUseId="t-1"
              toolSummary="file-a.ts"
              input="{}"
              status="complete"
              allowExpand
              autoExpandFileDiffs={false}
              ports={ports}
            />
          </SlotScopeProvider>
        </div>
        <div data-testid="sibling-pane">
          <SlotScopeProvider active={false}>
            <ToolBlockPresenter
              toolName="custom_tool"
              toolUseId="t-2"
              toolSummary="file-b.ts"
              input="{}"
              status="complete"
              allowExpand
              autoExpandFileDiffs={false}
              ports={ports}
            />
          </SlotScopeProvider>
        </div>
      </SlotRegistryProvider>,
    )

    expect(screen.getByTestId('dsh-pane').textContent).toContain('file-a.ts')
    expect(screen.getByTestId('sibling-pane').textContent).toContain('file-b.ts')
    errorSpy.mockRestore()
  })

  it('aborts pending async reconcile cleanly when disposed mid-flight', async () => {
    const registry = createSlotRegistry()
    let resolveImport!: (mod: Record<string, unknown>) => void
    const importPromise = new Promise<Record<string, unknown>>((resolveFn) => {
      resolveImport = resolveFn
    })
    const detachSpy = vi.fn()
    const api: DshPluginHostApi = {
      listClientPlugins: vi.fn(async () => ({
        entries: [
          {
            id: '@acme/dsh-sample-ui',
            name: '@acme/dsh-sample-ui',
            version: '1.0.0',
            rev: '1',
            entry: 'dist/client.js',
            styles: ['dist/client.css'],
            entryUrl: 'superone-plugin://pkg/sample/dist/client.js',
            styleUrls: ['superone-plugin://pkg/sample/dist/client.css'],
            apiVersion: 1 as const,
          },
        ],
        problems: [],
      })),
      invoke: vi.fn(),
      on: vi.fn(() => () => {}),
      onPluginsChanged: vi.fn(() => () => {}),
    }

    const manager = new DshClientPluginManager({
      api,
      registry,
      ensureShared: vi.fn(async () => ({})),
      importModule: () => importPromise,
      attachStylesheet: () => detachSpy,
      closeGhostPanels: vi.fn(),
    })

    const reconcilePromise = manager.reconcile()
    await waitFor(() => {
      expect(detachSpy).not.toHaveBeenCalled()
    })
    manager.dispose()
    resolveImport({
      default: (ctx: any) => {
        ctx.slots.registerList('session.header.actions', { id: 'leaked', component: () => null })
      },
    })
    await reconcilePromise

    expect(manager.getMountedIds()).toEqual([])
    expect(registry.getList('session.header.actions')).toEqual([])
    expect(detachSpy).toHaveBeenCalled()
  })

  it('keeps SUPERONE_SHARED_MODULES in exact parity with __SUPERONE_SHARED__', async () => {
    const { SUPERONE_SHARED_MODULES } = await import('../../../../../../../packages/plugin-sdk/src/shared-modules')
    const shared = await ensureSuperoneShared()
    expect(Object.keys(shared).sort()).toEqual([...SUPERONE_SHARED_MODULES].sort())
  })
})
