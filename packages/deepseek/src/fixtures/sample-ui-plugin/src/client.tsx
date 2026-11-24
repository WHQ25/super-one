import { useEffect, useState, type ComponentType, type ReactNode } from 'react'
import { Wrench } from 'lucide-react'
import { Badge } from '@superone/ui/components/ui/badge'
import { Button } from '@superone/ui/components/ui/button'
import {
  usePluginSession,
  usePluginTheme,
  type PluginActivityPanelProps,
  type PluginAssistantActionProps,
  type PluginComposerAreaProps,
  type PluginHeaderActionProps,
  type PluginMarkdownFenceProps,
  type PluginMessageRowProps,
  type PluginStatusBarItemProps,
  type PluginToolBlockProps,
  type SuperoneClientPluginContext,
} from '@superone/plugin-sdk'
import {
  SHOWCASE_SLOT_INVENTORY,
  getShowcaseOverrides,
  resetShowcaseOverrides,
  subscribeShowcaseOverrides,
  toggleShowcaseOverride,
  useShowcaseOverrides,
  type ShowcaseOverrides,
} from './showcase-state'
import {
  SampleFullSidebar,
  SampleSessionRowTrailing,
  SampleSidebarDrawer,
  SampleSidebarFooterAction,
  SampleSidebarTab,
} from './sidebar-showcase'

function SampleToolBlock({
  props,
  ctx,
}: {
  props: PluginToolBlockProps
  ctx: SuperoneClientPluginContext
}) {
  const [rpcLabel, setRpcLabel] = useState<string>('pending')
  const session = usePluginSession()

  useEffect(() => {
    let active = true
    void ctx.rpc.invoke<{ inspectedBy: string }>('inspectTool', { toolName: props.toolName }).then((res) => {
      if (!active) return
      setRpcLabel(res.ok ? res.data.inspectedBy : res.error.code)
    })
    return () => {
      active = false
    }
  }, [props.toolName, ctx])

  return (
    <div data-testid="sample-dsh-tool-block" className="sample-dsh-plugin-card flex items-center gap-2 rounded border px-2 py-1 text-xs">
      <Wrench className="size-3.5" />
      <span>{`dsh-plugin:${props.toolName}`}</span>
      <Badge variant="secondary">{rpcLabel}</Badge>
      {session.sessionId && <span data-testid="sample-tool-session">{session.sessionId}</span>}
      <Button
        size="sm"
        variant="ghost"
        onClick={() => void ctx.layout.openPanel({ panelKey: 'sample:inspector', title: 'Sample Inspector', params: { toolName: props.toolName } })}
      >
        Inspect
      </Button>
    </div>
  )
}

function SampleInspectorPanel({
  panelKey,
  title,
  ctx,
}: PluginActivityPanelProps & { ctx: SuperoneClientPluginContext }) {
  const session = usePluginSession()
  const theme = usePluginTheme()
  const overrides = useShowcaseOverrides()
  const [rpcResult, setRpcResult] = useState<string>('idle')

  const pingRpc = () => {
    setRpcResult('calling...')
    void ctx.rpc
      .invoke<{ inspectedBy: string; toolName: string }>('inspectTool', { toolName: 'inspector' })
      .then((res) => {
        setRpcResult(res.ok ? `${res.data.inspectedBy} (${res.data.toolName})` : `err:${res.error.code}`)
      })
  }

  return (
    <div data-testid="sample-dsh-inspector-panel" className="flex h-full flex-col gap-3 overflow-y-auto p-3 text-xs">
      <div className="sample-dsh-plugin-card flex flex-col gap-1.5 rounded-md border p-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium">{`Inspector:${title ?? panelKey}`}</span>
          <Badge variant="secondary">{`Theme:${theme.resolvedTheme}`}</Badge>
        </div>
        <div className="opacity-80">{`Session:${session.sessionId ?? 'none'} · ${session.provider ?? 'dsh'}`}</div>
        <div className="flex items-center gap-2 pt-1">
          <Button size="sm" variant="secondary" className="h-6 px-2 text-[11px]" onClick={pingRpc}>
            Ping pluginRpc
          </Button>
          <Badge variant="outline">{rpcResult}</Badge>
        </div>
      </div>

      <div className="sample-dsh-plugin-card flex flex-col gap-1.5 rounded-md border p-2.5">
        <div className="font-medium">Chain Override &amp; Overlay Toggles</div>
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(overrides) as Array<keyof ShowcaseOverrides>).map((key) => (
            <Button
              key={key}
              size="sm"
              variant={overrides[key] ? 'default' : 'outline'}
              className="h-6 px-2 text-[11px]"
              onClick={() => toggleShowcaseOverride(key)}
            >
              {`${key}: ${overrides[key] ? 'ON' : 'OFF'}`}
            </Button>
          ))}
        </div>
      </div>

      <div className="sample-dsh-plugin-card flex flex-col gap-1 rounded-md border p-2.5">
        <div className="font-medium">{`All Registered Surfaces (${SHOWCASE_SLOT_INVENTORY.length} slots)`}</div>
        <div className="grid grid-cols-1 gap-1 pt-1">
          {SHOWCASE_SLOT_INVENTORY.map((slot) => (
            <div key={slot.id} className="flex items-center justify-between gap-2 rounded bg-background/50 px-2 py-0.5">
              <code className="text-[11px]">{slot.id}</code>
              <span className="text-[10px] opacity-70">{`${slot.kind} · ${slot.scope}`}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function SampleSessionBanner({ ctx, children }: { ctx: SuperoneClientPluginContext; children: ReactNode }) {
  const session = usePluginSession()
  const overrides = useShowcaseOverrides()
  const [rpcState, setRpcState] = useState<string>('idle')

  const pingRpc = () => {
    setRpcState('calling...')
    void ctx.rpc.invoke<{ inspectedBy: string }>('inspectTool', { toolName: 'session.providers' }).then((res) => {
      setRpcState(res.ok ? `ok:${res.data.inspectedBy}` : res.error.code)
    })
  }

  return (
    <div data-testid="sample-dsh-session-provider" className="flex min-h-0 flex-1 flex-col">
      <div className="sample-dsh-plugin-card mx-3 mt-1 flex flex-wrap items-center justify-between gap-1.5 rounded-md border px-2 py-1 text-[11px]">
        <div className="flex items-center gap-1.5">
          <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
            session.providers (hoc)
          </Badge>
          <span className="opacity-80">{session.provider ?? 'dsh'}</span>
          <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
            {rpcState}
          </Badge>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <Button size="sm" variant="ghost" className="h-5 px-1.5 text-[10px]" onClick={pingRpc}>
            Ping RPC
          </Button>
          <Button
            size="sm"
            variant={overrides.workspaceView ? 'default' : 'ghost'}
            className="h-5 px-1.5 text-[10px]"
            onClick={() => toggleShowcaseOverride('workspaceView')}
          >
            workspace.view
          </Button>
          <Button
            size="sm"
            variant={overrides.transcript ? 'default' : 'ghost'}
            className="h-5 px-1.5 text-[10px]"
            onClick={() => toggleShowcaseOverride('transcript')}
          >
            chat.transcript
          </Button>
          <Button
            size="sm"
            variant={overrides.composer ? 'default' : 'ghost'}
            className="h-5 px-1.5 text-[10px]"
            onClick={() => toggleShowcaseOverride('composer')}
          >
            chat.composer
          </Button>
          <Button
            size="sm"
            variant={overrides.statusBar ? 'default' : 'ghost'}
            className="h-5 px-1.5 text-[10px]"
            onClick={() => toggleShowcaseOverride('statusBar')}
          >
            chat.statusBar
          </Button>
          <Button
            size="sm"
            variant={overrides.overlay ? 'default' : 'ghost'}
            className="h-5 px-1.5 text-[10px]"
            onClick={() => toggleShowcaseOverride('overlay')}
          >
            shell.overlay
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-5 px-1.5 text-[10px]"
            onClick={() => void ctx.commands.executeCommand('sample.inspect.open')}
          >
            Inspector
          </Button>
        </div>
      </div>
      {children}
    </div>
  )
}

function SampleComposerToolbarButton({ ctx }: { ctx: SuperoneClientPluginContext }) {
  return (
    <button
      type="button"
      data-testid="sample-dsh-composer-button"
      onClick={() => void ctx.commands.executeCommand('sample.inspect.open')}
      className="sample-dsh-pill rounded px-1.5 py-0.5 text-[11px]"
    >
      Sample
    </button>
  )
}

function SampleMarkdownFence({ code, language }: PluginMarkdownFenceProps) {
  return (
    <div data-testid="sample-dsh-markdown-fence" data-language={language} className="sample-dsh-plugin-card rounded border p-2 text-xs">
      {`fence:${code.trim()}`}
    </div>
  )
}

function wrapSampleMessageRow(Row: ComponentType<PluginMessageRowProps>) {
  return function SampleMessageRowWrapper(props: PluginMessageRowProps) {
    return (
      <div
        data-testid="sample-dsh-message-row"
        data-message-id={props.messageId}
        className="border-l-2 border-l-[var(--dsh-sample-accent,var(--primary))] pl-1"
      >
        <Row {...props} />
      </div>
    )
  }
}

function SampleEmptyState({ ctx }: { ctx: SuperoneClientPluginContext }) {
  const session = usePluginSession()
  return (
    <div data-testid="sample-dsh-empty-state" className="flex flex-1 items-center justify-center p-6">
      <div className="sample-dsh-plugin-card flex max-w-md flex-col gap-2.5 rounded-xl border p-4 text-xs">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">dsh Microkernel Showcase</span>
          <Badge variant="secondary">chat.emptyState (chain)</Badge>
        </div>
        <div className="opacity-80">
          {`Active in ${session.provider ?? 'dsh'} pane only. Try Ctrl+Shift+K, session right-click menu, or Settings -> dsh Sample UI.`}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="default" className="h-7 px-2.5 text-xs" onClick={() => void ctx.commands.executeCommand('sample.inspect.open')}>
            Open Inspector (activity.panel)
          </Button>
          <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs" onClick={() => toggleShowcaseOverride('emptyState')}>
            Show Stock Empty State
          </Button>
        </div>
      </div>
    </div>
  )
}

function SampleSettingsPage({
  area,
  activeTab,
  onSelectTab,
}: {
  area: 'nav' | 'content'
  activeTab: string
  onSelectTab: (tabId: string) => void
}) {
  const tabId = 'sample-dsh-settings'
  if (area === 'nav') {
    return (
      <button
        type="button"
        data-testid="sample-dsh-settings-nav"
        onClick={() => onSelectTab(tabId)}
        className={`mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
          activeTab === tabId ? 'bg-accent text-accent-foreground font-medium' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
        }`}
      >
        dsh Sample UI
      </button>
    )
  }
  if (activeTab !== tabId) return null
  return (
    <div data-testid="sample-dsh-settings-page" className="mx-auto flex max-w-2xl flex-col gap-3 p-6 text-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">dsh Microkernel Showcase (shell.settings.pages)</h2>
        <Badge variant="secondary">{`${SHOWCASE_SLOT_INVENTORY.length} slots`}</Badge>
      </div>
      <div className="sample-dsh-plugin-card rounded-lg border p-3 text-xs">
        {`All ${SHOWCASE_SLOT_INVENTORY.length} UI slots, 4 menus, and 5 ClientKernel buses are registered by @acme/dsh-sample-ui.`}
      </div>
      <div className="grid grid-cols-1 gap-1.5 text-xs sm:grid-cols-2">
        {SHOWCASE_SLOT_INVENTORY.map((slot) => (
          <div key={slot.id} className="flex items-center justify-between rounded border border-border px-2.5 py-1.5">
            <code>{slot.id}</code>
            <span className="opacity-70">{`${slot.kind} · ${slot.scope}`}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function SampleOverlayBadge({ view }: { view: string }) {
  const overrides = useShowcaseOverrides()
  if (!overrides.overlay) return null
  return (
    <div
      data-testid="sample-dsh-overlay"
      className="sample-dsh-plugin-card pointer-events-auto fixed right-4 bottom-12 z-50 flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs shadow-md"
    >
      <Badge variant="secondary">shell.overlay.items</Badge>
      <span>{`view:${view}`}</span>
      <button type="button" className="underline" onClick={() => toggleShowcaseOverride('overlay')}>
        Hide
      </button>
    </div>
  )
}

export default function activate(ctx: SuperoneClientPluginContext) {
  ctx.onDispose(() => {
    resetShowcaseOverrides()
  })

  ctx.commands.registerCommand({
    id: 'sample.inspect.open',
    title: 'Open Sample Inspector',
    handler: () => ctx.layout.openPanel({ panelKey: 'sample:inspector', title: 'Sample Inspector' }),
  })

  ctx.commands.registerCommand({
    id: 'sample.rpc.ping',
    title: 'Ping Sample Plugin RPC',
    handler: () => ctx.rpc.invoke('inspectTool', { toolName: 'command-bus' }),
  })

  ctx.keybindings.registerKeybinding({
    key: 'ctrl+shift+k',
    command: 'sample.inspect.open',
  })

  ctx.menus.registerMenuItem('session.contextMenu', {
    id: 'sample-inspect-session',
    label: 'Inspect Session (Sample)',
    command: 'sample.inspect.open',
  })

  ctx.menus.registerMenuItem('session.headerMenu', {
    id: 'sample-header-menu-inspect',
    label: 'Sample Microkernel Inspector',
    command: 'sample.inspect.open',
  })

  ctx.menus.registerMenuItem('composer.plusMenu', {
    id: 'sample-plus-menu-inspect',
    label: 'Open Sample Inspector',
    command: 'sample.inspect.open',
  })

  ctx.menus.registerMenuItem('activity.launcher', {
    id: 'sample-inspector-launch',
    label: 'Sample Inspector',
    command: 'sample.inspect.open',
  })

  ctx.theme.registerLayer({
    lightTokens: { '--primary': { h: 278 } },
    cssVars: { '--dsh-sample-accent': 'oklch(0.62 0.19 278)' },
  })

  ctx.slots.registerSessionProvider({
    id: 'sample-session-provider',
    wrap: (Inner) =>
      function SampleSessionProvider(props) {
        return (
          <SampleSessionBanner ctx={ctx}>
            <Inner {...props} />
          </SampleSessionBanner>
        )
      },
  })

  ctx.slots.registerHeaderAction({
    id: 'sample-header-action',
    component: (_props: PluginHeaderActionProps) => (
      <button
        type="button"
        data-testid="sample-dsh-header-action"
        onClick={() => void ctx.commands.executeCommand('sample.inspect.open')}
        className="sample-dsh-pill rounded px-2 py-0.5 text-[11px]"
      >
        session.header.actions
      </button>
    ),
  })

  ctx.slots.registerMessageRow({
    id: 'sample-message-row',
    wrap: wrapSampleMessageRow,
  })

  ctx.slots.registerAssistantAction({
    id: 'sample-assistant-action',
    component: (_props: PluginAssistantActionProps) => (
      <button
        type="button"
        data-testid="sample-dsh-assistant-action"
        onClick={() => void ctx.commands.executeCommand('sample.inspect.open')}
        className="sample-dsh-pill rounded px-1.5 py-0.5 text-[10px]"
      >
        assistant.actions
      </button>
    ),
  })

  ctx.slots.registerMarkdownFence({
    id: 'sample-markdown-fence',
    priority: 10,
    match: (props) => props.language === 'dsh-card',
    render: (props) => <SampleMarkdownFence {...props} />,
  })

  ctx.slots.registerToolBlock({
    id: 'sample-tool-block',
    priority: 10,
    match: (props) => props.toolName === 'sample_inspect',
    render: (props) => <SampleToolBlock props={props} ctx={ctx} />,
  })

  ctx.slots.registerList('chat.composer.dock.top', {
    id: 'sample-composer-dock-top',
    component: (_props: PluginComposerAreaProps) => (
      <div data-testid="sample-dsh-composer-dock-top" className="sample-dsh-pill mb-1 flex items-center justify-between rounded px-2 py-0.5 text-[10px]">
        <span>chat.composer.dock.top</span>
        <span>Ctrl+Shift+K</span>
      </div>
    ),
  })

  ctx.slots.registerComposerToolbarLeft({
    id: 'sample-composer-toolbar-left',
    component: (_props: PluginComposerAreaProps) => (
      <span data-testid="sample-dsh-composer-left" className="sample-dsh-pill rounded px-1.5 py-0.5 text-[10px]">
        toolbar.left
      </span>
    ),
  })

  ctx.slots.registerComposerToolbarRight({
    id: 'sample-composer-toolbar',
    component: (_props: PluginComposerAreaProps) => <SampleComposerToolbarButton ctx={ctx} />,
  })

  ctx.slots.registerStatusBarItem('left', {
    id: 'sample-status-left',
    component: (_props: PluginStatusBarItemProps) => (
      <span data-testid="sample-dsh-status-left" className="sample-dsh-pill rounded px-1.5 py-0.5 text-[10px]">
        statusBar.left
      </span>
    ),
  })

  ctx.slots.registerStatusBarItem('right', {
    id: 'sample-status-right',
    component: (_props: PluginStatusBarItemProps) => (
      <span data-testid="sample-dsh-status-right" className="sample-dsh-pill rounded px-1.5 py-0.5 text-[10px]">
        statusBar.right
      </span>
    ),
  })

  ctx.slots.registerList('activity.launcher', {
    id: 'sample-activity-launcher-slot',
    component: () => (
      <button
        type="button"
        data-testid="sample-dsh-activity-launcher"
        onClick={() => void ctx.commands.executeCommand('sample.inspect.open')}
        className="sample-dsh-plugin-card flex items-center justify-between rounded-lg border px-3 py-2 text-left text-xs"
      >
        <span>activity.launcher · Sample Inspector</span>
        <Badge variant="secondary">dsh</Badge>
      </button>
    ),
  })

  ctx.slots.registerActivityPanel('sample:inspector', {
    id: 'sample-inspector-panel',
    component: (props) => <SampleInspectorPanel {...props} ctx={ctx} />,
  })

  ctx.slots.registerList('shell.settings.pages', {
    id: 'sample-settings-page',
    component: SampleSettingsPage,
  })

  ctx.slots.registerList('shell.overlay.items', {
    id: 'sample-overlay-item',
    component: SampleOverlayBadge,
  })

  ctx.slots.registerList('sidebar.tabs', {
    id: 'sample-sidebar-tab',
    component: (props) => <SampleSidebarTab {...props} ctx={ctx} />,
  })

  ctx.slots.registerList('sidebar.drawer', {
    id: 'sample-sidebar-drawer',
    component: () => <SampleSidebarDrawer ctx={ctx} />,
  })

  ctx.slots.registerList('sidebar.footer.actions', {
    id: 'sample-sidebar-footer-action',
    component: SampleSidebarFooterAction,
  })

  ctx.slots.registerList('sidebar.session.row.trailing', {
    id: 'sample-sidebar-row-trailing',
    component: SampleSessionRowTrailing,
  })

  let fullSidebarDisposer: (() => void) | null = null
  let workspaceDisposer: (() => void) | null = null
  let transcriptDisposer: (() => void) | null = null
  let emptyStateDisposer: (() => void) | null = null
  let composerDisposer: (() => void) | null = null
  let statusBarDisposer: (() => void) | null = null

  const syncToggleSlots = () => {
    const overrides = getShowcaseOverrides()
    if (overrides.sidebarFull && !fullSidebarDisposer) {
      fullSidebarDisposer = ctx.slots.registerSingle('shell.sidebar.content', {
        id: 'sample-full-sidebar',
        priority: 10,
        component: () => <SampleFullSidebar ctx={ctx} />,
      })
    } else if (!overrides.sidebarFull && fullSidebarDisposer) {
      fullSidebarDisposer()
      fullSidebarDisposer = null
    }

    if (overrides.workspaceView && !workspaceDisposer) {
      workspaceDisposer = ctx.slots.registerChain('workspace.view', {
        id: 'sample-workspace-view',
        priority: 10,
        render: () => (
          <div data-testid="sample-dsh-workspace-view" className="sample-dsh-plugin-card m-4 flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border p-6 text-xs">
            <Badge variant="secondary">workspace.view (chain override)</Badge>
            <div>Entire session workspace replaced by @acme/dsh-sample-ui inside this dsh pane.</div>
            <Button size="sm" variant="outline" onClick={() => toggleShowcaseOverride('workspaceView')}>
              Restore Stock Workspace
            </Button>
          </div>
        ),
      })
    } else if (!overrides.workspaceView && workspaceDisposer) {
      workspaceDisposer()
      workspaceDisposer = null
    }

    if (overrides.transcript && !transcriptDisposer) {
      transcriptDisposer = ctx.slots.registerChain('chat.transcript', {
        id: 'sample-chat-transcript',
        priority: 10,
        render: () => (
          <div data-testid="sample-dsh-transcript" className="sample-dsh-plugin-card m-3 flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border p-4 text-xs">
            <Badge variant="secondary">chat.transcript (chain override)</Badge>
            <div>Transcript area replaced by @acme/dsh-sample-ui.</div>
            <Button size="sm" variant="outline" onClick={() => toggleShowcaseOverride('transcript')}>
              Restore Stock Transcript
            </Button>
          </div>
        ),
      })
    } else if (!overrides.transcript && transcriptDisposer) {
      transcriptDisposer()
      transcriptDisposer = null
    }

    if (overrides.emptyState && !emptyStateDisposer) {
      emptyStateDisposer = ctx.slots.registerChain('chat.emptyState', {
        id: 'sample-empty-state',
        priority: 10,
        render: () => <SampleEmptyState ctx={ctx} />,
      })
    } else if (!overrides.emptyState && emptyStateDisposer) {
      emptyStateDisposer()
      emptyStateDisposer = null
    }

    if (overrides.composer && !composerDisposer) {
      composerDisposer = ctx.slots.registerChain('chat.composer', {
        id: 'sample-chat-composer',
        priority: 10,
        render: () => (
          <div data-testid="sample-dsh-composer-override" className="sample-dsh-plugin-card m-3 flex items-center justify-between gap-2 rounded-xl border p-3 text-xs">
            <div className="flex items-center gap-2">
              <Badge variant="secondary">chat.composer (chain override)</Badge>
              <span>Custom plugin composer card active.</span>
            </div>
            <Button size="sm" variant="outline" onClick={() => toggleShowcaseOverride('composer')}>
              Restore Stock Composer
            </Button>
          </div>
        ),
      })
    } else if (!overrides.composer && composerDisposer) {
      composerDisposer()
      composerDisposer = null
    }

    if (overrides.statusBar && !statusBarDisposer) {
      statusBarDisposer = ctx.slots.registerChain('chat.statusBar', {
        id: 'sample-chat-status-bar',
        priority: 10,
        render: () => (
          <div data-testid="sample-dsh-statusbar-override" className="sample-dsh-plugin-card mx-3 mb-1 flex items-center justify-between rounded border px-2.5 py-1 text-[11px]">
            <Badge variant="secondary">chat.statusBar (chain override)</Badge>
            <Button size="sm" variant="ghost" className="h-5 px-2 text-[10px]" onClick={() => toggleShowcaseOverride('statusBar')}>
              Restore Stock StatusBar
            </Button>
          </div>
        ),
      })
    } else if (!overrides.statusBar && statusBarDisposer) {
      statusBarDisposer()
      statusBarDisposer = null
    }
  }

  syncToggleSlots()
  const unsubToggles = subscribeShowcaseOverrides(syncToggleSlots)
  ctx.onDispose(() => {
    unsubToggles()
    fullSidebarDisposer?.()
    workspaceDisposer?.()
    transcriptDisposer?.()
    emptyStateDisposer?.()
    composerDisposer?.()
    statusBarDisposer?.()
  })
}
