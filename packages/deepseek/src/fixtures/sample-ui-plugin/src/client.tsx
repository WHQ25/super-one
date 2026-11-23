import { useEffect, useState } from 'react'
import { Wrench } from 'lucide-react'
import { Badge } from '@superone/ui/components/ui/badge'
import { Button } from '@superone/ui/components/ui/button'
import {
  usePluginSession,
  usePluginTheme,
  type PluginActivityPanelProps,
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
        onClick={() => ctx.activity.openPanel('sample:inspector', 'Sample Inspector', { toolName: props.toolName })}
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

export default function activate(ctx: SuperoneClientPluginContext) {
  ctx.slots.registerToolBlock({
    id: 'sample-tool-block',
    priority: 10,
    match: (props) => props.toolName === 'sample_inspect',
    render: (props) => <SampleToolBlock props={props} ctx={ctx} />,
  })

  ctx.slots.registerActivityPanel('sample:inspector', {
    id: 'sample-inspector-panel',
    component: SampleInspectorPanel,
  })
}
