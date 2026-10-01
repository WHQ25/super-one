import type { Meta, StoryObj } from '@storybook/react-vite'
import { Loader2 } from 'lucide-react'
import { PortableToolRow } from './PortableToolRow'

const meta = {
  title: 'Tool UI/Mobile/Row state',
  component: PortableToolRow,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <div style={{ width: 360 }}><Story /></div>],
} satisfies Meta<typeof PortableToolRow>
export default meta
type Story = StoryObj<typeof meta>

const mcpRow = {
  toolName: 'mcp__mcp-apps-fixture__fixture_list_items',
  toolUseId: 'mcp-1',
  input: JSON.stringify({ page: 1 }),
  status: 'complete' as const,
  result: 'Page 1/4: item-1, item-2, item-3',
  hasDeferredDetails: true,
}

/** A state with nothing to do yet. */
export const Loading: Story = {
  args: {
    ...mcpRow,
    trailing: <><Loader2 className="size-3 animate-spin" /><span>Loading app…</span></>,
  },
}

/** A state and its one action; tapping the action leaves the row collapsed. */
export const WithAction: Story = {
  args: {
    ...mcpRow,
    trailing: (
      <button type="button" onClick={() => console.info('activate')} className="rounded bg-muted px-2 py-0.5 text-xs text-foreground">
        Activate
      </button>
    ),
  },
}

/** A long state truncates; the action keeps its size. */
export const Narrow: Story = {
  decorators: [(Story) => <div style={{ width: 280 }}><Story /></div>],
  args: {
    ...mcpRow,
    trailing: (
      <>
        <span className="truncate">Sign in on the desktop</span>
        <button type="button" className="shrink-0 rounded bg-muted px-2 py-0.5 text-xs text-foreground">Retry</button>
      </>
    ),
  },
}
