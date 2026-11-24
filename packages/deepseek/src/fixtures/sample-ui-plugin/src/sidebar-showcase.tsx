import { Badge } from '@superone/ui/components/ui/badge'
import { Button } from '@superone/ui/components/ui/button'
import {
  usePluginSession,
  type PluginSidebarSessionRowTrailingProps,
  type PluginSidebarTabProps,
  type SuperoneClientPluginContext,
} from '@superone/plugin-sdk'
import {
  SHOWCASE_SLOT_INVENTORY,
  toggleShowcaseOverride,
  useShowcaseOverrides,
  type ShowcaseOverrides,
} from './showcase-state'

const SAMPLE_SIDEBAR_TAB_ID = 'sample-dsh-sidebar-tab'

export function SampleSidebarTab({
  ctx,
  area,
  activeTab,
  onSelectTab,
}: PluginSidebarTabProps & { ctx: SuperoneClientPluginContext }) {
  const session = usePluginSession()
  const overrides = useShowcaseOverrides()

  if (area === 'tab') {
    const isActive = activeTab === SAMPLE_SIDEBAR_TAB_ID
    return (
      <button
        type="button"
        role="tab"
        aria-selected={isActive}
        data-slot="tabs-trigger"
        data-testid="sample-dsh-sidebar-tab-trigger"
        data-state={isActive ? 'active' : 'inactive'}
        onClick={() => onSelectTab(SAMPLE_SIDEBAR_TAB_ID)}
        className="relative z-10 inline-flex flex-1 items-center justify-center gap-1 whitespace-nowrap rounded px-2 py-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground data-[state=active]:text-foreground"
      >
        <span>dsh</span>
      </button>
    )
  }

  if (activeTab !== SAMPLE_SIDEBAR_TAB_ID) return null

  return (
    <div data-testid="sample-dsh-sidebar-tab-content" className="flex flex-1 flex-col gap-2 overflow-y-auto px-2.5 py-2 text-xs">
      <div className="sample-dsh-plugin-card flex flex-col gap-1.5 rounded-lg border p-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium">sidebar.tabs</span>
          <Badge variant="secondary">{session.provider ?? 'dsh'}</Badge>
        </div>
        <div className="opacity-80">
          Incremental sidebar tab injected when a dsh session is active. Switching to another harness falls back automatically.
        </div>
        <div className="flex flex-wrap gap-1.5 pt-1">
          <Button
            size="sm"
            variant={overrides.sidebarFull ? 'default' : 'outline'}
            className="h-6 px-2 text-[11px]"
            onClick={() => toggleShowcaseOverride('sidebarFull')}
          >
            {overrides.sidebarFull ? 'Restore Sidebar' : 'Replace Full Sidebar'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-[11px]"
            onClick={() => void ctx.commands.executeCommand('sample.inspect.open')}
          >
            Inspector
          </Button>
        </div>
      </div>

      <div className="sample-dsh-plugin-card flex flex-col gap-1 rounded-lg border p-2.5">
        <div className="font-medium">Chain &amp; Shell Overrides</div>
        <div className="flex flex-wrap gap-1">
          {(Object.keys(overrides) as Array<keyof ShowcaseOverrides>).map((key) => (
            <Button
              key={key}
              size="sm"
              variant={overrides[key] ? 'default' : 'outline'}
              className="h-6 px-2 text-[10px]"
              onClick={() => toggleShowcaseOverride(key)}
            >
              {`${key}: ${overrides[key] ? 'ON' : 'OFF'}`}
            </Button>
          ))}
        </div>
      </div>
    </div>
  )
}

export function SampleSidebarDrawer({ ctx }: { ctx: SuperoneClientPluginContext }) {
  const overrides = useShowcaseOverrides()
  return (
    <div
      data-testid="sample-dsh-sidebar-drawer"
      className="sample-dsh-plugin-card mx-2 mb-1.5 flex items-center justify-between gap-1.5 rounded-md border px-2 py-1 text-[11px]"
    >
      <span className="truncate font-medium">sidebar.drawer · dsh</span>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          size="sm"
          variant={overrides.sidebarFull ? 'default' : 'ghost'}
          className="h-5 px-1.5 text-[10px]"
          onClick={() => toggleShowcaseOverride('sidebarFull')}
        >
          {overrides.sidebarFull ? 'Restore' : 'Replace'}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-5 px-1.5 text-[10px]"
          onClick={() => void ctx.commands.executeCommand('sample.inspect.open')}
        >
          Inspect
        </Button>
      </div>
    </div>
  )
}

export function SampleSidebarFooterAction() {
  const overrides = useShowcaseOverrides()
  return (
    <button
      type="button"
      data-testid="sample-dsh-sidebar-footer-action"
      onClick={() => toggleShowcaseOverride('sidebarFull')}
      className="sample-dsh-pill ml-auto rounded px-1.5 py-0.5 text-[10px]"
    >
      {overrides.sidebarFull ? 'stock' : 'footer.actions'}
    </button>
  )
}

export function SampleSessionRowTrailing(_props: PluginSidebarSessionRowTrailingProps) {
  return (
    <span
      data-testid="sample-dsh-row-trailing"
      className="sample-dsh-pill mr-1 rounded px-1 py-px text-[9px] leading-tight"
    >
      dsh
    </span>
  )
}

export function SampleFullSidebar({ ctx }: { ctx: SuperoneClientPluginContext }) {
  const session = usePluginSession()
  const overrides = useShowcaseOverrides()
  return (
    <div data-testid="sample-dsh-full-sidebar" className="flex min-h-0 w-full flex-1 flex-col gap-2 bg-sidebar px-2 pb-2 pt-0 text-xs text-sidebar-foreground">
      <div className="sample-dsh-plugin-card flex flex-col gap-1.5 rounded-lg border p-2.5">
        <div className="flex items-center justify-between gap-2">
          <Badge variant="secondary">shell.sidebar.content</Badge>
          <span className="opacity-70">{session.provider ?? 'dsh'}</span>
        </div>
        <div className="opacity-85">
          Full sidebar replaced by @acme/dsh-sample-ui for dsh sessions. Switching focus to any non-dsh session restores the stock sidebar.
        </div>
        <div className="flex flex-wrap gap-1.5 pt-1">
          <Button
            size="sm"
            variant="default"
            className="h-7 px-2.5 text-xs"
            onClick={() => toggleShowcaseOverride('sidebarFull')}
          >
            Restore Default Sidebar
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2.5 text-xs"
            onClick={() => void ctx.commands.executeCommand('sample.inspect.open')}
          >
            Open Inspector
          </Button>
        </div>
      </div>

      <div className="sample-dsh-plugin-card flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto rounded-lg border p-2.5">
        <div className="font-medium">{`All ${SHOWCASE_SLOT_INVENTORY.length} Customizable Slots`}</div>
        {(Object.keys(overrides) as Array<keyof ShowcaseOverrides>).map((key) => (
          <div key={key} className="flex items-center justify-between gap-2">
            <span>{key}</span>
            <Button
              size="sm"
              variant={overrides[key] ? 'default' : 'outline'}
              className="h-5 px-2 text-[10px]"
              onClick={() => toggleShowcaseOverride(key)}
            >
              {overrides[key] ? 'ON' : 'OFF'}
            </Button>
          </div>
        ))}
      </div>
    </div>
  )
}
