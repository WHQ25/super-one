import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState, type ReactNode } from 'react'
import { ToolBlock } from './ToolBlock'
import { useMiniAppStore } from '@/stores/miniapp'
import type { MiniAppEntry } from '@superone/shared/miniapp-types'

function StoryShell({ children, width = 720 }: { children: ReactNode; width?: number }) {
  return (
    <div className="@container" style={{ maxWidth: width }}>
      {children}
    </div>
  )
}

const APP: MiniAppEntry = {
  id: 'crm-tools',
  installDir: '/Users/me/.superone/apps/crm-tools',
  manifest: {
    appId: 'crm-tools',
    name: 'CRM Tools',
    version: '0.4.0',
    toolSlug: 'crm',
    tools: [
      {
        name: 'find_contact',
        description: 'Look up a contact by name or email.',
        displayName: 'Find contact',
        runningText: 'Searching contacts',
        inputSummaryField: 'query',
        resultSummaryField: 'name',
        showResult: true,
        inputSchema: {},
      },
      {
        name: 'add_note',
        description: 'Append a note to a contact record.',
        displayName: 'Add note',
        runningText: 'Saving note',
        inputSummaryField: 'contactId',
        showResult: false,
        inputSchema: {},
      },
    ],
  },
}

function SeedApps({ children }: { children: ReactNode }) {
  useState(() => {
    useMiniAppStore.setState({ apps: [APP], loaded: true })
    return null
  })
  return <>{children}</>
}

const meta: Meta<typeof ToolBlock> = {
  title: 'Common/AppToolBlock',
  component: ToolBlock,
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => <SeedApps><StoryShell><Story /></StoryShell></SeedApps>,
  ],
}

export default meta
type Story = StoryObj<typeof ToolBlock>

export const Streaming: Story = {
  args: {
    toolName: 'mcp__superone__crm__find_contact',
    input: JSON.stringify({ query: 'alice@example.com' }),
    status: 'streaming',
    elapsedSeconds: 1,
  },
}

export const CompleteWithResult: Story = {
  args: {
    toolName: 'mcp__superone__crm__find_contact',
    input: JSON.stringify({ query: 'alice@example.com' }),
    status: 'complete',
    result: JSON.stringify({ id: 'c-42', name: 'Alice Wong', company: 'Acme Co.', email: 'alice@example.com' }),
  },
}

export const CompleteNoResultUI: Story = {
  args: {
    toolName: 'mcp__superone__crm__add_note',
    input: JSON.stringify({ contactId: 'c-42', body: 'Met at conference, follow up next week.' }),
    status: 'complete',
    result: JSON.stringify({ ok: true }),
  },
}

export const UnknownApp: Story = {
  args: {
    toolName: 'mcp__superone__notinstalled__do_thing',
    input: JSON.stringify({ x: 1 }),
    status: 'complete',
    result: JSON.stringify({ note: 'plug icon fallback when app not found' }),
  },
}
