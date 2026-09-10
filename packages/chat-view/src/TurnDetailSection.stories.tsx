import type { ReactNode } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ChatMessage, ContentBlock } from '@superone/shared/agent-types'
import { initializeChatViewI18n } from './i18n'
import { PortableMessage } from './PortableMessage'
import { TurnDetailSection } from './TurnDetailSection'

void initializeChatViewI18n('en')

function Phone({ children }: { children: ReactNode }) {
  return <div className="w-[390px] space-y-3 p-3">{children}</div>
}

const meta = {
  title: 'Chat/Mobile compact Detail',
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Compact-mode Detail header. Progressive mobile rows keep +N/−M on the shell (`toolLineDelta`); the header must still show those counts after bodies are stripped.',
      },
    },
  },
} satisfies Meta

export default meta
type Story = StoryObj

const lineCountRuns = [
  { key: 'process', collapsible: true, content: <div className="text-xs text-muted-foreground">hidden process</div> },
  { key: 'answer', collapsible: false, content: <p className="text-sm">Updated the preview flag.</p> },
]

export const LineCounts: Story = {
  name: 'Collapsed · tool / file / line counts',
  render: () => (
    <Phone>
      <TurnDetailSection
        stats={{ toolCalls: 4, filesChanged: 2, added: 64, removed: 12 }}
        runs={lineCountRuns}
      />
    </Phone>
  ),
}

export const ToolsOnly: Story = {
  name: 'Collapsed · tools, no file mutations',
  render: () => (
    <Phone>
      <TurnDetailSection
        stats={{ toolCalls: 3, filesChanged: 0, added: 0, removed: 0 }}
        runs={[
          { key: 'process', collapsible: true, content: <div className="text-xs text-muted-foreground">hidden process</div> },
          { key: 'answer', collapsible: false, content: <p className="text-sm">Searched the repo.</p> },
        ]}
      />
    </Phone>
  ),
}

export const Working: Story = {
  name: 'Collapsed · working duration',
  render: () => (
    <Phone>
      <TurnDetailSection
        stats={{ toolCalls: 2, filesChanged: 1, added: 8, removed: 3 }}
        workingSince={Date.now() - 45_000}
        runs={[{ key: 'process', collapsible: true, content: <div className="text-xs text-muted-foreground">hidden process</div> }]}
      />
    </Phone>
  ),
}

export const Expanded: Story = {
  name: 'Expanded',
  render: LineCounts.render,
  play: async ({ canvasElement }) => {
    canvasElement.querySelector<HTMLButtonElement>('button')?.click()
  },
}

function progressiveEdit(id: string, path: string, added: number, removed: number): ContentBlock[] {
  return [
    {
      type: 'tool_use',
      toolName: 'Edit',
      toolUseId: id,
      status: 'complete',
      input: JSON.stringify({ file_path: path }),
      toolFilePath: path,
      toolLineDelta: { added, removed },
      remoteDetail: JSON.stringify(['turn', 'tool', id]),
    },
    { type: 'tool_result', toolUseId: id, summary: '' },
  ]
}

function progressiveTurn(): ChatMessage {
  return {
    id: 'turn',
    role: 'assistant',
    providerId: 'claude',
    createdAt: '2026-09-09T00:00:00Z',
    status: 'complete',
    content: [
      { type: 'thinking', thinking: '', remoteDetail: JSON.stringify(['turn', 'thinking', 0]) },
      {
        type: 'tool_use',
        toolName: 'Read',
        toolUseId: 'r1',
        status: 'complete',
        input: JSON.stringify({ file_path: '/workspace/src/config.ts' }),
        toolSummary: 'config.ts',
        toolFilePath: 'src/config.ts',
        remoteDetail: JSON.stringify(['turn', 'tool', 'r1']),
      },
      { type: 'tool_result', toolUseId: 'r1', summary: '' },
      ...progressiveEdit('e1', '/workspace/src/config.ts', 2, 1),
      ...progressiveEdit('e2', '/workspace/src/preview.ts', 8, 3),
      { type: 'text', text: 'Updated the preview flag and the catalog entry.' },
    ],
  }
}

export const ProgressiveTurn: Story = {
  name: 'Phone turn · stripped edits still show +/−',
  render: () => (
    <Phone>
      <PortableMessage
        message={progressiveTurn()}
        scheme="dark"
        pendingPermission={null}
        isLastAssistant
        sessionStreaming={false}
      />
    </Phone>
  ),
}

export const ProgressiveTurnExpanded: Story = {
  name: 'Phone turn · expand Detail',
  render: ProgressiveTurn.render,
  play: async ({ canvasElement }) => {
    canvasElement.querySelector<HTMLButtonElement>('.turn-detail-section button')?.click()
  },
}
