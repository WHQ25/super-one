import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { ContextAttachments, type ContextAttachmentItem } from '@superone/ui/components/ui/context-attachments'
import { mcpAppContextItems } from '@superone/shared/mcp-app-model-context'

const icon = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"%3E%3Crect width="20" height="20" rx="5" fill="%23ea580c"/%3E%3Cpath d="M6 10h8M10 6v8" stroke="white" stroke-width="2"/%3E%3C/svg%3E'
const items: ContextAttachmentItem[] = [
  { id: 'part', icon, source: 'Bits & Bolts', title: 'Agent dial', content: '{"part":"agent-dial","material":"PLA"}', thumbnail: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"%3E%3Ccircle cx="10" cy="10" r="8" fill="%237c3aed"/%3E%3C/svg%3E' },
  { id: 'image', icon, source: 'Bits & Bolts', title: 'Assembly drawing' },
  { id: 'raw', icon, source: 'Bits & Bolts', title: 'selected view: {"page":"viewer","dirty":false,"writable":false,"part":"part_keycap_openai"}', content: 'Bits & Bolts selected view: {"page":"viewer","dirty":false,"writable":false,"part":"part_keycap_openai"}' },
]
function Scenario({ initial = items, width = 640, loading = false, error }: { initial?: ContextAttachmentItem[]; width?: number; loading?: boolean; error?: string }) {
  const [attachments, setAttachments] = useState(initial)
  return <div style={{ width, maxWidth: '100%' }} className="rounded-xl border border-border bg-background p-3">
    <ContextAttachments items={attachments} loading={loading} error={error} onRemove={id => setAttachments(current => current.filter(item => item.id !== id))} />
    <div className="mt-2 rounded-md border border-border p-3 text-sm text-muted-foreground">Message composer</div>
  </div>
}
const meta: Meta<typeof Scenario> = { title: 'Chat/Context Attachments', component: Scenario, parameters: { layout: 'padded' } }
export default meta
type Story = StoryObj<typeof Scenario>
export const Attached: Story = {}
export const Loading: Story = { args: { initial: [], loading: true } }
export const Empty: Story = { args: { initial: [] } }
export const Error: Story = { args: { error: 'Could not remove context. The host is disconnected.' } }
export const LongContent: Story = { args: { initial: [{ id: 'long', source: 'An app with a long name', title: 'An extremely long attachment label '.repeat(5), content: 'Long payload\n'.repeat(200) }] } }
export const Narrow: Story = { args: { width: 280 } }
export const NarrowLong: Story = { args: { width: 280, initial: [{ id: 'long', source: 'Bits & Bolts', title: 'An extremely long attachment label '.repeat(5) }] } }

export const BackgroundContext: Story = { args: { initial: [{ id: 'background', icon, title: 'Bits & Bolts context', content: 'Hidden background selection\n{"part":"dial"}' }] } }
export const Removing: Story = { render: () => <ContextAttachments items={items} onRemove={() => {}} removing={items.map(item => item.id)} /> }
/**
 * Bits & Bolts' real context, derived as the composer derives it: its one-colour dark-stroke
 * icon stays visible on a dark theme, and the labelled JSON is titled by its label alone.
 */
export const DarkStrokeIcon: Story = {
  args: { initial: mcpAppContextItems({
    appInstanceId: 'view', binding: { node: 'local', session: 's', server: 'bits-and-bolts', configGeneration: 0, configFingerprint: 'f' }, status: 'result', resourceUri: 'ui://cad/library',
    presentation: { toolTitle: 'cad.library', serverTitle: 'Bits & Bolts', icons: [{ src: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path fill="none" stroke="#27272a" stroke-width="3" stroke-linejoin="round" d="M9.5 4.75h13L29 16l-6.5 11.25h-13L3 16zM13 10.8h6l3 5.2-3 5.2h-6L10 16z"/></svg>') }] },
    modelContext: { updateId: 'u', source: { appInstanceId: 'view', server: 'bits-and-bolts' }, content: [{ type: 'text', text: 'Bits & Bolts selected view: {"page":"viewer","dirty":false,"writable":false,"part":"part_keycap_openai"}' }] },
  }, 'm') },
  globals: { theme: 'dark' },
}

export const WithoutSourceIcon: Story = { args: { initial: [{ id: 'plain', source: 'Fixture', title: 'Selected row' }] } }
export const Dark: Story = { globals: { theme: 'dark' } }
export const ChineseNarrow: Story = { args: { width: 280 }, globals: { locale: 'zh' } }
