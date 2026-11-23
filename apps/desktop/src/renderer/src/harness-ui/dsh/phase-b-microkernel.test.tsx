/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { execFileSync } from 'node:child_process'
import { cp, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createClientKernel } from '@superone/client-kernel'
import { ClientKernelProvider, useMenuItems } from '@superone/client-kernel/react'
import { SlotChain, SlotHoc, SlotList, SlotScopeProvider } from '@superone/ui-slots/react'
import { HARNESS_CAPABILITIES } from '@superone/shared/harness/harness-capabilities'
import {
  DeepseekPlugins,
  createDeepseekTree,
  installPluginFromDirectory,
  readClientPluginEntries,
  setPluginDisabled,
} from '@superone/deepseek'
import { createPluginProtocolHandler } from '../../../../main/deepseek/plugin-protocol'
import { bindMiniWindowLayoutAdapter, getAppClientKernel } from '@/lib/client-kernel'
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

let tempRoots: string[] = []

beforeEach(() => {
  resetSuperoneSharedForTest()
})

afterEach(async () => {
  cleanup()
  resetSuperoneSharedForTest()
  await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

function MenuProbe({ testId, supportsUiPlugins }: { testId: string; supportsUiPlugins: boolean }) {
  const items = useMenuItems('session.contextMenu', {
    menuId: 'session.contextMenu',
    sessionId: supportsUiPlugins ? 's-dsh' : 's-claude',
    provider: supportsUiPlugins ? 'dsh' : 'claude',
    supportsUiPlugins,
  })
  return <div data-testid={testId}>{items.map((i) => i.label).join('|')}</div>
}

function DefaultFence({ language, code }: { language: string; code: string }) {
  return <pre data-testid="stock-fence">{`${language}:${code}`}</pre>
}

function DefaultRow({ messageId, children }: { messageId: string; children: React.ReactNode }) {
  return <div data-testid={`stock-row-${messageId}`}>{children}</div>
}

describe('Phase B microkernel end-to-end sample plugin & Mosaic isolation', () => {
  it('isolates keybindings, menus, pane theme, toolbar, fence, message.row, and layout.openPanel across dsh and claude panes', async () => {
    const pluginRoot = await realpath(await mkdtemp(join(tmpdir(), 'phase-b-plugins-')))
    const fixtureStage = await realpath(await mkdtemp(join(tmpdir(), 'phase-b-fixture-')))
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
    await plugins.sync()

    const protocolHandler = createPluginProtocolHandler(() => pluginRoot, { devRendererUrl: () => undefined })
    const listeners = new Set<() => void>()
    const rpc = tree.get('pluginRpc')!
    const kernel = createClientKernel()
    const openPanelCalls: string[] = []
    const unbindDesktopLayout = kernel.layout.setAdapter({
      openPanel: (req) => {
        openPanelCalls.push(req.panelKey)
        return { ok: true, data: { tab: `plugin:${req.panelKey}` } }
      },
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
      on: () => () => {},
      onPluginsChanged: (cb) => {
        listeners.add(cb)
        return () => listeners.delete(cb)
      },
    }

    const manager = new DshClientPluginManager({
      api,
      kernel,
      ensureShared: ensureSuperoneShared,
      importModule: async (url) => {
        const res = await protocolHandler(new Request(url, { headers: { origin: 'superone-renderer://app' } }))
        expect(res.status).toBe(200)
        const diskPath = join(pluginRoot, 'node_modules', '@acme', 'dsh-sample-ui', 'dist', 'client.js')
        return (await import(/* @vite-ignore */ `${pathToFileURL(diskPath).href}?t=${Date.now()}`)) as Record<string, unknown>
      },
      closeGhostPanels: vi.fn(),
    })

    try {
      await act(async () => {
        manager.start()
        await new Promise((r) => setTimeout(r, 30))
      })
      await waitFor(() => {
        expect(manager.getMountedIds()).toEqual(['@acme/dsh-sample-ui'])
      })

      render(
        <ClientKernelProvider kernel={kernel}>
          <div data-testid="dsh-pane">
            <SlotScopeProvider active={HARNESS_CAPABILITIES.dsh.supportsUiPlugins} scope={{ sessionId: 's-dsh' }}>
              <MenuProbe testId="dsh-menu" supportsUiPlugins={true} />
              <SlotList name="chat.composer.toolbar.right" props={{ sessionId: 's-dsh', projectPath: '/repo', compact: false }} />
              <SlotChain
                name="chat.markdown.fence"
                props={{ kind: 'code', code: 'hello dsh', language: 'dsh-card', isComplete: true }}
                fallback={(p) => <DefaultFence language={p.language} code={p.code} />}
              />
              <SlotHoc
                name="chat.message.row"
                component={DefaultRow as any}
                props={{ messageId: 'm1', role: 'assistant', isStreaming: false, sessionId: 's-dsh', projectPath: '/repo' }}
              >
                <span>row-content</span>
              </SlotHoc>
            </SlotScopeProvider>
          </div>
          <div data-testid="claude-pane">
            <SlotScopeProvider active={HARNESS_CAPABILITIES.claude.supportsUiPlugins} scope={{ sessionId: 's-claude' }}>
              <MenuProbe testId="claude-menu" supportsUiPlugins={false} />
              <SlotList name="chat.composer.toolbar.right" props={{ sessionId: 's-claude', projectPath: '/repo', compact: false }} />
              <SlotChain
                name="chat.markdown.fence"
                props={{ kind: 'code', code: 'hello dsh', language: 'dsh-card', isComplete: true }}
                fallback={(p) => <DefaultFence language={p.language} code={p.code} />}
              />
              <SlotHoc
                name="chat.message.row"
                component={DefaultRow as any}
                props={{ messageId: 'm2', role: 'assistant', isStreaming: false, sessionId: 's-claude', projectPath: '/repo' }}
              >
                <span>row-content</span>
              </SlotHoc>
            </SlotScopeProvider>
          </div>
        </ClientKernelProvider>,
      )

      const dshPane = screen.getByTestId('dsh-pane')
      const claudePane = screen.getByTestId('claude-pane')

      expect(screen.getByTestId('dsh-menu').textContent).toBe('Inspect Session (Sample)')
      expect(screen.getByTestId('claude-menu').textContent).toBe('')
      expect(dshPane.querySelector('[data-testid="sample-dsh-composer-button"]')).not.toBeNull()
      expect(claudePane.querySelector('[data-testid="sample-dsh-composer-button"]')).toBeNull()
      expect(dshPane.querySelector('[data-testid="sample-dsh-markdown-fence"]')?.textContent).toBe('fence:hello dsh')
      expect(claudePane.querySelector('[data-testid="stock-fence"]')?.textContent).toBe('dsh-card:hello dsh')
      expect(dshPane.querySelector('[data-testid="sample-dsh-message-row"]')).not.toBeNull()
      expect(claudePane.querySelector('[data-testid="sample-dsh-message-row"]')).toBeNull()

      expect(kernel.theme.getOverrides().cssVars['--dsh-sample-accent']).toBeUndefined()
      expect(kernel.theme.getOverrides({ harness: 'claude' }).cssVars['--dsh-sample-accent']).toBeUndefined()
      expect(kernel.theme.getOverrides({ harness: 'dsh' }).cssVars['--dsh-sample-accent']).toBe('oklch(0.62 0.19 278)')

      const evClaude = new KeyboardEvent('keydown', { key: 'K', code: 'KeyK', ctrlKey: true, shiftKey: true, cancelable: true })
      expect(
        kernel.keybindings.handleKeyEvent(evClaude, () => ({
          view: 'main',
          provider: 'claude',
          supportsUiPlugins: false,
          inTerminal: false,
          inInput: false,
          inActivity: false,
          focusArea: 'chat',
        })),
      ).toBe(false)
      expect(openPanelCalls).toEqual([])

      const evDsh = new KeyboardEvent('keydown', { key: 'K', code: 'KeyK', ctrlKey: true, shiftKey: true, cancelable: true })
      expect(
        kernel.keybindings.handleKeyEvent(evDsh, () => ({
          view: 'main',
          provider: 'dsh',
          supportsUiPlugins: true,
          inTerminal: false,
          inInput: false,
          inActivity: false,
          focusArea: 'chat',
        })),
      ).toBe(true)
      await waitFor(() => {
        expect(openPanelCalls).toEqual(['sample:inspector'])
      })

      const miniKernel = createClientKernel()
      bindMiniWindowLayoutAdapter(miniKernel)
      await expect(
        miniKernel.layout.openPanel({ panelKey: 'sample:inspector', title: 'Sample Inspector' }),
      ).resolves.toMatchObject({ ok: false, unsupported: true, code: 'unsupported' })

      await setPluginDisabled(pluginRoot, '@acme/dsh-sample-ui', true)
      await plugins.sync()
      await act(async () => {
        for (const cb of listeners) cb()
        await new Promise((r) => setTimeout(r, 20))
      })

      expect(manager.getMountedIds()).toEqual([])
      expect(kernel.commands.hasCommand('sample.inspect.open')).toBe(false)
      expect(kernel.keybindings.listKeybindings()).toEqual([])
      expect(kernel.theme.getOverrides({ harness: 'dsh' }).cssVars['--dsh-sample-accent']).toBeUndefined()
      expect(screen.getByTestId('dsh-menu').textContent).toBe('')
      expect(dshPane.querySelector('[data-testid="sample-dsh-composer-button"]')).toBeNull()
      expect(dshPane.querySelector('[data-testid="sample-dsh-message-row"]')).toBeNull()
      expect(rpc.hasHandler('@acme/dsh-sample-ui', 'inspectTool')).toBe(false)
    } finally {
      unbindDesktopLayout()
      manager.dispose()
      kernel.dispose()
      void getAppClientKernel()
      await plugins.dispose()
      await tree.fiber.dispose()
    }
  })
})
