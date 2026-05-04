import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState, type ReactNode } from 'react'
import { ToolBlock } from './ToolBlock'
import { useMiniAppStore } from '@/stores/miniapp'
import type { MiniAppEntry } from '../../../../shared/miniapp-types'

function StoryShell({ children, width = 720 }: { children: ReactNode; width?: number }) {
  return (
    <div className="@container" style={{ maxWidth: width }}>
      {children}
    </div>
  )
}

const APP: MiniAppEntry = {
  id: 'expense-tracker',
  installDir: '/Users/me/.superone/apps/expense-tracker',
  manifest: {
    appId: 'expense-tracker',
    name: 'Expense Tracker',
    version: '1.0.0',
    toolSlug: 'expense',
    templates: {
      receiptCard: 'templates/receipt-card.html',
    },
    tools: [
      {
        name: 'add_expense',
        description: 'Record a new expense.',
        displayName: 'Add expense',
        runningText: 'Saving expense',
        showResult: true,
        inputSummaryField: 'merchant',
        resultSummaryField: 'amount',
        inputSchema: {},
        renderer: {
          result: {
            template: 'receiptCard',
            autoExpand: true,
          },
        },
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
  title: 'Chat/AppResultRendererBlock',
  component: ToolBlock,
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => <SeedApps><StoryShell><Story /></StoryShell></SeedApps>,
  ],
}

export default meta
type Story = StoryObj<typeof ToolBlock>

export const AutoExpanded: Story = {
  args: {
    toolName: 'mcp__superone__expense__add_expense',
    toolUseId: 'tu-expense-1',
    input: JSON.stringify({ merchant: 'Blue Bottle Coffee', amount: 7.5, currency: 'USD' }),
    status: 'complete',
    result: JSON.stringify({
      id: 'exp-1024',
      merchant: 'Blue Bottle Coffee',
      amount: 7.5,
      currency: 'USD',
      timestamp: '2026-05-04T10:14:00Z',
    }),
  },
}

export const StreamingNotYetReady: Story = {
  args: {
    toolName: 'mcp__superone__expense__add_expense',
    toolUseId: 'tu-expense-2',
    input: JSON.stringify({ merchant: 'Trader Joe\'s', amount: 32.18 }),
    status: 'streaming',
    elapsedSeconds: 1,
  },
}
