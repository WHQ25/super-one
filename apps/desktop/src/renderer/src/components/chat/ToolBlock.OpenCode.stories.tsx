import type { Meta, StoryObj } from '@storybook/react-vite'
import { ToolBlock } from './ToolBlock'
import { NestedToolContext } from './nested-tool-context'
import { useEffect } from 'react'
import { ChatMessage } from './ChatMessage'
import { useAppStore } from '@/stores/app'
import type { ChatMessage as ChatMessageType } from '@superone/shared/agent-types'

const meta: Meta<typeof ToolBlock> = {
  title: 'Tool UI/General/OpenCode Integration',
  component: ToolBlock,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <div className="@container max-w-[640px]"><Story /></div>],
}

export default meta
type Story = StoryObj<typeof ToolBlock>

// Wire-shaped historical inputs from the reported OpenCode V2 session. The
// production presenters, not a story-only adapter, supply their aliases.
const readInput = JSON.stringify({ path: '/Users/me/projects/super-one/CLAUDE.md', offset: 1, limit: 88 })
const skillInput = JSON.stringify({ id: 'opencode' })
const patchInput = JSON.stringify({ patchText: '*** Begin Patch\n*** Update File: src/config.ts\n@@\n-export const enabled = false\n+export const enabled = true\n*** Add File: src/new.ts\n+export const answer = 42\n*** Update File: src/old.ts\n*** Move to: src/renamed.ts\n*** Delete File: src/obsolete.ts\n*** End Patch' })
const codeInput = JSON.stringify({ code: 'const results = await Promise.all([\n  tools.context7["query-docs"]({ libraryId: "/websites/opencode_ai_v2", query: "Tool inputs" }),\n  tools.opencode.models({ query: "GPT" }),\n])\nreturn results' })

export const Complete: Story = {
  render: () => <>
    <ToolBlock toolName="superone_session_rename" input='{"title":"修复 OpenCode v2 工具展示集成"}' result="Session renamed" status="complete" />
    <ToolBlock toolName="Read" input={readInput} status="complete" />
    <ToolBlock toolName="skill" input={skillInput} status="complete" />
    <ToolBlock toolName="skill" input='{"id":"vercel-react-best-practices"}' status="complete" />
    <ToolBlock toolName="superone_read_manual" input='{"domain":"product","topic":"browser"}' status="complete" />
  </>,
}

export const Streaming: Story = {
  render: () => <>
    <ToolBlock toolName="superone_session_rename" input="{}" status="streaming" />
    <ToolBlock toolName="Read" input={readInput} status="streaming" />
    <ToolBlock toolName="skill" input="{}" status="streaming" />
    <ToolBlock toolName="skill" input={skillInput} status="streaming" elapsedSeconds={2} />
  </>,
}

export const Error: Story = {
  render: () => <>
    <ToolBlock toolName="Read" input={readInput} result="File not found" isError status="complete" />
    <ToolBlock toolName="skill" input={skillInput} result="Skill not found" isError status="complete" />
  </>,
}

export const Denied: Story = {
  render: () => <>
    <ToolBlock toolName="Read" input={readInput} result="[denied] User denied permission" status="complete" />
    <ToolBlock toolName="skill" input={skillInput} result="[denied] User denied permission" status="complete" />
  </>,
}

export const Nested: Story = {
  args: { toolName: 'skill', input: skillInput, status: 'complete', grouped: true },
  decorators: [(Story) => <NestedToolContext.Provider value={{ allowExpand: false }}><Story /></NestedToolContext.Provider>],
}

export const Narrow: Story = {
  ...Complete,
  decorators: [(Story) => <div className="@container w-[320px]"><Story /></div>],
}

export const PatchAndCode: Story = {
  render: () => <>
    <ToolBlock toolName="patch" input={patchInput} result="Success. Updated 4 files." status="complete" />
    <ToolBlock toolName="execute" input={codeInput} result='{"results":["Tool documentation","Model catalog"]}' status="complete" />
  </>,
}

export const PatchAndCodeExpanded: Story = {
  render: () => <>
    <ToolBlock toolName="Patch" input={patchInput} status="complete" autoExpand />
    <ToolBlock toolName="CodeExecution" input={codeInput} result='{"results":["Tool documentation","Model catalog"]}' status="complete" />
  </>,
}

export const PatchAndCodeStreaming: Story = {
  render: () => <>
    <ToolBlock toolName="Patch" input="{}" status="streaming" />
    <ToolBlock toolName="Patch" input={patchInput} status="streaming" />
    <ToolBlock toolName="CodeExecution" input={codeInput} status="streaming" elapsedSeconds={2} />
  </>,
}

export const PatchAndCodeError: Story = {
  render: () => <>
    <ToolBlock toolName="Patch" input={patchInput} result="Patch context did not match" isError status="complete" />
    <ToolBlock toolName="CodeExecution" input={codeInput} result="Tool call failed" isError status="complete" />
  </>,
}

export const PatchAndCodeDenied: Story = {
  render: () => <>
    <ToolBlock toolName="Patch" input={patchInput} result="[denied] User denied permission" status="complete" />
    <ToolBlock toolName="CodeExecution" input={codeInput} result="[denied] User denied permission" status="complete" />
  </>,
}

export const PatchAndCodeNested: Story = {
  ...PatchAndCode,
  decorators: [(Story) => <NestedToolContext.Provider value={{ allowExpand: false }}><Story /></NestedToolContext.Provider>],
}

export const PatchAndCodeNarrow: Story = {
  ...PatchAndCode,
  decorators: [(Story) => <div className="@container w-[320px]"><Story /></div>],
}

const statsPatchInput = JSON.stringify({ patchText: '*** Begin Patch\n*** Update File: src/config.ts\n@@\n-export const enabled = false\n+export const enabled = true\n+export const mode = "preview"\n*** Add File: src/new.ts\n+export const answer = 42\n*** End Patch' })

function PatchDetailStatisticsPreview() {
  useEffect(() => {
    const previous = useAppStore.getState().detailChatMode
    useAppStore.setState({ detailChatMode: false })
    return () => { useAppStore.setState({ detailChatMode: previous }) }
  }, [])
  const message: ChatMessageType = {
    id: 'patch-statistics', role: 'assistant', providerId: 'opencode', status: 'complete', createdAt: '2026-10-07T12:00:00Z',
    content: [
      { type: 'tool_use', toolName: 'Read', toolUseId: 'read', input: '{"file_path":"src/config.ts"}', status: 'complete' },
      { type: 'tool_result', toolUseId: 'read', summary: '' },
      { type: 'tool_use', toolName: 'Patch', toolUseId: 'patch', input: statsPatchInput, status: 'complete' },
      { type: 'tool_result', toolUseId: 'patch', summary: 'Applied' },
      { type: 'tool_use', toolName: 'CodeExecution', toolUseId: 'code', input: '{"code":"return 42"}', status: 'complete' },
      { type: 'tool_result', toolUseId: 'code', summary: '42' },
      { type: 'text', text: 'Updated the two files.' },
    ],
  }
  return <div className="space-y-4">
    <ToolBlock toolName="Patch" input={statsPatchInput} status="complete" autoExpand={false} />
    <ChatMessage message={message} sessionStatus="idle" isLastAssistant />
  </div>
}

export const PatchDetailStatistics: Story = {
  render: () => <PatchDetailStatisticsPreview />,
}

export const PatchDetailStatisticsNarrow: Story = {
  ...PatchDetailStatistics,
  decorators: [(Story) => <div className="@container w-[320px]"><Story /></div>],
}
