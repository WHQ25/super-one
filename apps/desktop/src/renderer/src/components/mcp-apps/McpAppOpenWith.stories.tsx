import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { ChevronRight, FileX2 } from 'lucide-react'
import { FileIcon } from '@superone/ui/components/ui/FileIcon'
import type { McpAppFileHandler } from '@superone/shared/mcp-app-files'
import { McpAppOpenWithActions, McpAppOpenWithButton } from './McpAppOpenWith'

const CAD_ICON = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"%3E%3Cpath fill="%237c3aed" d="M2 1h12v14H2z"/%3E%3C/svg%3E'
// One-colour black stroke: painted in the text colour so it stays visible on the dark theme.
const MONO_ICON = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%23000" stroke-width="2"%3E%3Cpath d="M12 2 21 7v10l-9 5-9-5V7z"/%3E%3Ccircle cx="12" cy="12" r="3"/%3E%3C/svg%3E'
const HANDLERS: McpAppFileHandler[] = [
  { server: 'bits-and-bolts', tool: 'cad.open', title: 'Bits & Bolts CAD viewer', serverTitle: 'Bits & Bolts', icon: CAD_ICON },
  { server: 'nut-works', tool: 'nut.view', title: 'Nut Works viewer', serverTitle: 'Nut Works', icon: MONO_ICON },
  { server: 'mesh-tools', tool: 'mesh.inspect', title: 'Mesh inspector with a very long descriptive tool title for narrow panes' },
]

type Lookup = 'apps' | 'none' | 'loading' | 'failOpen'
let story = 0

/** Each render is its own session, so the module-level handler cache never leaks between stories. */
function useStoryScope(lookup: Lookup) {
  const [scope] = useState(() => ({ projectPath: '/work/cad', sessionId: `story-${lookup}-${++story}` }))
  const env = (window as unknown as { environment?: Record<string, unknown> }).environment ?? {}
  ;(window as unknown as { environment: Record<string, unknown> }).environment = {
    ...env,
    mcpAppFileHandlers: () => lookup === 'loading' ? new Promise(() => {}) : Promise.resolve({ ok: true, value: { handlers: lookup === 'none' ? [] : HANDLERS } }),
    mcpAppOpenFile: () => Promise.resolve(lookup === 'failOpen'
      ? { ok: false, error: { code: 'not_connected', message: 'The CAD server is not running' } }
      : { ok: false, error: { code: 'cancelled', message: 'Storybook does not open Apps' } }),
  }
  return scope
}

function PreviewHeader({ lookup, width }: { lookup: Lookup; width: number }) {
  const scope = useStoryScope(lookup)
  return (
    <div className="rounded-md border border-border bg-background" style={{ width }}>
      <div className="flex h-8 items-center gap-1 px-2">
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
          <span className="text-xs text-muted-foreground">parts</span>
          <ChevronRight className="size-3 shrink-0 text-muted-foreground/50" />
          <FileIcon name="hex-bolt.stl" size={13} className="shrink-0" />
          <span className="truncate text-xs font-medium">hex-bolt.stl</span>
        </div>
        <McpAppOpenWithButton absolutePath="/work/cad/parts/hex-bolt.stl" scope={scope} />
      </div>
      <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">SuperOne 3D preview</div>
    </div>
  )
}

function Unpreviewable({ lookup, width }: { lookup: Lookup; width: number }) {
  const scope = useStoryScope(lookup)
  return (
    <div className="flex h-64 flex-col items-center justify-center gap-2 rounded-md border border-border bg-background text-muted-foreground" style={{ width }}>
      <FileX2 className="size-8 opacity-30" />
      <span className="text-xs">Binary file — preview not supported</span>
      <McpAppOpenWithActions absolutePath="/work/cad/parts/bracket.step" scope={scope} />
    </div>
  )
}

function Scenario({ surface, lookup, width = 560 }: { surface: 'header' | 'placeholder'; lookup: Lookup; width?: number }) {
  return <div className="p-6">{surface === 'header' ? <PreviewHeader lookup={lookup} width={width} /> : <Unpreviewable lookup={lookup} width={width} />}</div>
}

const meta: Meta<typeof Scenario> = { title: 'MCP Apps/Open With', component: Scenario, parameters: { layout: 'fullscreen' }, args: { surface: 'header', lookup: 'apps' } }
export default meta
type Story = StoryObj<typeof Scenario>

/** SuperOne previews the file; the header offers Apps that also open it. */
export const HeaderWithApps: Story = {}
/** No App declares this extension: the header stays as it was. */
export const HeaderNoApps: Story = { args: { lookup: 'none' } }
export const PlaceholderLoading: Story = { args: { surface: 'placeholder', lookup: 'loading' } }
/** SuperOne cannot preview the format; each App is one explicit action. */
export const PlaceholderWithApps: Story = { args: { surface: 'placeholder' } }
export const PlaceholderNoApps: Story = { args: { surface: 'placeholder', lookup: 'none' } }
/** Opening fails (server down): the error surfaces as a toast. */
export const OpenFails: Story = { args: { surface: 'placeholder', lookup: 'failOpen' } }
export const ChineseNarrow: Story = { args: { surface: 'placeholder', width: 300 }, globals: { locale: 'zh' } }
export const Dark: Story = { globals: { theme: 'dark' } }
