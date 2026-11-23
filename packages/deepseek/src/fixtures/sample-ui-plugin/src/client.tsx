import { useEffect, useState, type ComponentType } from 'react'
import { Wrench } from 'lucide-react'
import { Badge } from '@superone/ui/components/ui/badge'
import { Button } from '@superone/ui/components/ui/button'
import {
  usePluginSession,
  usePluginTheme,
  type PluginActivityPanelProps,
  type PluginComposerAreaProps,
  type PluginMarkdownFenceProps,
  type PluginMessageRowProps,
  type PluginToolBlockProps,
  type SuperoneClientPluginContext,
} from '@superone/plugin-sdk'

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

function SampleInspectorPanel({ panelKey, title }: PluginActivityPanelProps) {
  const session = usePluginSession()
  const theme = usePluginTheme()
  return (
    <div data-testid="sample-dsh-inspector-panel" className="sample-dsh-plugin-card p-3 text-xs">
      <div>{`Inspector:${title ?? panelKey}`}</div>
      <div>{`Session:${session.sessionId ?? 'none'}`}</div>
      <div>{`Theme:${theme.resolvedTheme}`}</div>
    </div>
  )
}

function SampleComposerToolbarButton({ ctx }: { ctx: SuperoneClientPluginContext }) {
  return (
    <button
      type="button"
      data-testid="sample-dsh-composer-button"
      onClick={() => void ctx.commands.executeCommand('sample.inspect.open')}
      className="rounded px-1.5 py-0.5 text-[11px] hover:bg-muted"
    >
      Sample
    </button>
  )
}

function SampleMarkdownFence({ code, language }: PluginMarkdownFenceProps) {
  return (
    <div data-testid="sample-dsh-markdown-fence" data-language={language} className="rounded border p-2 text-xs">
      {`fence:${code.trim()}`}
    </div>
  )
}

function wrapSampleMessageRow(Row: ComponentType<PluginMessageRowProps>) {
  return function SampleMessageRowWrapper(props: PluginMessageRowProps) {
    return (
      <div data-testid="sample-dsh-message-row" data-message-id={props.messageId}>
        <Row {...props} />
      </div>
    )
  }
}

export default function activate(ctx: SuperoneClientPluginContext) {
  ctx.commands.registerCommand({
    id: 'sample.inspect.open',
    title: 'Open Sample Inspector',
    handler: () => ctx.layout.openPanel({ panelKey: 'sample:inspector', title: 'Sample Inspector' }),
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

  ctx.menus.registerMenuItem('activity.launcher', {
    id: 'sample-inspector-launch',
    label: 'Sample Inspector',
    command: 'sample.inspect.open',
  })

  ctx.theme.registerLayer({
    lightTokens: { '--primary': { h: 278 } },
    cssVars: { '--dsh-sample-accent': 'oklch(0.62 0.19 278)' },
  })

  ctx.slots.registerToolBlock({
    id: 'sample-tool-block',
    priority: 10,
    match: (props) => props.toolName === 'sample_inspect',
    render: (props) => <SampleToolBlock props={props} ctx={ctx} />,
  })

  ctx.slots.registerComposerToolbarRight({
    id: 'sample-composer-toolbar',
    component: (_props: PluginComposerAreaProps) => <SampleComposerToolbarButton ctx={ctx} />,
  })

  ctx.slots.registerMarkdownFence({
    id: 'sample-markdown-fence',
    priority: 10,
    match: (props) => props.language === 'dsh-card',
    render: (props) => <SampleMarkdownFence {...props} />,
  })

  ctx.slots.registerMessageRow({
    id: 'sample-message-row',
    wrap: wrapSampleMessageRow,
  })

  ctx.slots.registerActivityPanel('sample:inspector', {
    id: 'sample-inspector-panel',
    component: SampleInspectorPanel,
  })
}
