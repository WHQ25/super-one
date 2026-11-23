import type { IDockviewPanelProps } from 'dockview-core'
import { useSlotKeyed } from '@superone/ui-slots/react'
import { PluginSlotErrorBoundary } from '@/lib/ui-slots'

function PluginDockPanelFallback() {
  return (
    <div
      data-plugin-panel-fallback=""
      className="flex h-full items-center justify-center p-4 text-xs text-muted-foreground"
    >
      Plugin panel unavailable
    </div>
  )
}

export function PluginDockPanel(
  props: IDockviewPanelProps<{ panelKey: string; pluginId?: string; [key: string]: unknown }>,
) {
  const { panelKey, pluginId } = props.params
  const PanelComponent = useSlotKeyed('activity.panel', panelKey)
  if (!PanelComponent) return <PluginDockPanelFallback />
  return (
    <PluginSlotErrorBoundary resetKey={panelKey} fallback={<PluginDockPanelFallback />}>
      <PanelComponent
        panelKey={panelKey}
        pluginId={pluginId}
        title={props.api.title}
        params={props.params}
      />
    </PluginSlotErrorBoundary>
  )
}
