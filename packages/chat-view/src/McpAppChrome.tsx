import { mcpAppHeaderTitle, mcpAppPresentationIcon, mcpAppServerTitle } from '@superone/shared/mcp-apps-metadata'
import type { ToolAppAttachment } from '@superone/shared/mcp-apps'
import { useContext, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { CodeXml } from 'lucide-react'
import { EmbeddedToolView } from '@superone/ui/components/ui/embedded-tool-view'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { McpAppStateCard, type McpAppState } from '@superone/ui/components/ui/mcp-app-state'
import { PortableTurnContext } from './portable-turn-context'
import { useMcpToolIconSrc } from './PortableToolRow'
import { getToolDisplay, parseMcpToolName } from './presenters/tool-display'
import { ToolBrandIcon } from './presenters/ToolIcon'

/** The desktop's MCP App frame on the phone: the same header, actions, state card and collapse. */
export function McpAppChrome({ app, toolName, details, state, actions, activation, notice, collapsed, onToggleCollapsed, className, children }: {
  app: ToolAppAttachment
  toolName: string
  /** The call's tool row, expanded, behind the header's details toggle. */
  details: ReactNode
  state?: McpAppState | null
  /** Before the details toggle, like the desktop's display-mode buttons. */
  actions?: ReactNode
  /** After the details toggle, like the desktop's activate button. */
  activation?: ReactNode
  /** A line under the header while the View is shown, e.g. a failed activation. */
  notice?: ReactNode
  collapsed?: boolean
  onToggleCollapsed?: () => void
  className?: string
  children?: ReactNode
}) {
  const { t } = useTranslation()
  const { scheme } = useContext(PortableTurnContext)
  const iconSrc = useMcpToolIconSrc(toolName)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const server = mcpAppServerTitle(app)
  const tool = parseMcpToolName(toolName)
  return (
    <EmbeddedToolView
      pinnedHeader
      className={className}
      collapsed={collapsed}
      onToggleCollapsed={onToggleCollapsed}
      expandLabel={t('tooltips.expandView')}
      collapseLabel={t('tooltips.collapseView')}
      title={mcpAppHeaderTitle(server, app.presentation?.toolTitle ?? tool?.mcpToolName ?? app.resourceUri)}
      icon={<ToolBrandIcon src={mcpAppPresentationIcon(app.presentation, scheme) ?? iconSrc} alt={server} icon={getToolDisplay(toolName, app.toolInput ?? {}).icon} />}
      actions={<>
        {actions}
        <IconButton size="xs" variant="ghost" tooltip={t('mcpApp.toolDetails')} aria-expanded={detailsOpen} onClick={() => setDetailsOpen((value) => !value)}>
          <CodeXml className="size-3" />
        </IconButton>
        {activation}
      </>}
    >
      {state ? <McpAppStateCard state={state} /> : null}
      {!collapsed && notice}
      {!collapsed && detailsOpen ? <div className="mb-2">{details}</div> : null}
      {children}
    </EmbeddedToolView>
  )
}
