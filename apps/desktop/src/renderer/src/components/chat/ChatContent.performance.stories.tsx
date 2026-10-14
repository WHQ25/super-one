import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useRef, useState } from 'react'
import type { ChatMessage, CodexThreadItem } from '@superone/shared/agent-types'
import { Button } from '@superone/ui/components/ui/button'
import { TooltipProvider } from '@superone/ui/components/ui/tooltip'
import { useChatScroll } from '@/hooks/useChatScroll'
import { ACTIVITY_PANEL_TRANSITION } from '@/lib/layout-constants'
import { createDefaultPerSessionState, createDefaultProjectState, useChatStore } from '@/stores/chat'
import { useAppStore } from '@/stores/app'
import { useCodexRealtimeViewStore } from '@/stores/codex-realtime-view'
import { ChatContent } from './ChatContent'
import { mockTranscriptIpc } from './chat-transcript-story-mocks'

mockTranscriptIpc()

export function performanceHistory(count: number, paragraphs: number, chinese = false): ChatMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `perf-${index}`,
    role: index % 2 === 0 ? 'user' : 'assistant',
    providerId: index % 2 === 0 ? 'local' : 'claude',
    status: 'complete',
    createdAt: '2026-10-05T00:00:00.000Z',
    content: [{ type: 'text', text: index % 2 === 0
      ? `Please inspect the behavior for request ${index}.`
      : Array.from({ length: paragraphs }, (_, paragraph) => chinese
        ? `段落 ${paragraph}：${'这是首次向上滚动时需要准确保持阅读位置的中文长段落。'.repeat(9)}`
        : `Paragraph ${paragraph}: This explanation describes how a long conversation processes layout, scroll position, and visible content. **Measured content** includes \`message.id\`, a [documentation link](https://example.com), and sufficient prose to wrap across several lines when the activity panel opens.`).join('\n\n') }],
  }))
}

export function performanceCodexTurn(): ChatMessage {
  const items: CodexThreadItem[] = []
  for (let index = 0; index < 800; index++) {
    items.push(
      { id: `thought-${index}`, type: 'reasoning', text: `Reviewing activity ${index}.` },
      { id: `command-${index}`, type: 'command_execution', command: `echo activity-${index}`, aggregatedOutput: `output-activity-${index}\n`, exitCode: 0, status: 'completed' },
    )
    if (index % 20 === 0) items.push({ id: `progress-${index}`, type: 'agent_message', text: `Progress ${index}: ${'A short update about the current investigation. '.repeat(6)}` })
  }
  return { id: 'codex-long-turn', role: 'assistant', providerId: 'codex', status: 'complete', createdAt: '2026-10-05T00:00:00.000Z', content: [], metadata: { codex: { threadId: 'codex_local_performance', usage: null, items } } }
}

/** Reasoning directly above narration, repeated across several virtual chunks. */
export function reasoningNarrationTurn(): ChatMessage {
  const items: CodexThreadItem[] = Array.from({ length: 30 }, (_, index) => [
    { id: `thought-${index}`, type: 'reasoning', text: `Reviewing step ${index}.` },
    { id: `update-${index}`, type: 'agent_message', text: `Update ${index}: ${'The narration that follows a reasoning block. '.repeat(4)}` },
    { id: `command-${index}`, type: 'command_execution', command: `echo step-${index}`, aggregatedOutput: `step-${index}\n`, exitCode: 0, status: 'completed' },
  ] satisfies CodexThreadItem[]).flat()
  return { ...performanceCodexTurn(), id: 'codex-reasoning-narration', metadata: { codex: { threadId: 'codex_local_reasoning', usage: null, items } } }
}

/**
 * Investigation turns, then a short final reply. Opening at the end leaves little
 * room below the long turns, whose estimates are far below their measured height.
 */
function claudeToolHistory(count: number): ChatMessage[] {
  const messages = performanceHistory(count, 1)
  return messages.map((message, messageIndex) => {
    if (message.role !== 'assistant' || messageIndex === messages.length - 1) return message
    const content: ChatMessage['content'] = []
    for (let index = 0; index < 60; index++) {
      const id = `${message.id}-tool-${index}`
      if (index % 6 === 0) content.push({ type: 'text', text: `Note ${index}: ${'Checking the next part of the investigation. '.repeat(3)}` })
      content.push(
        { type: 'tool_use', toolUseId: id, toolName: 'Bash', input: JSON.stringify({ command: `grep -rn "pattern-${index}" src` }), status: 'complete' },
        { type: 'tool_result', toolUseId: id, summary: `result-${index}` },
      )
    }
    content.push({ type: 'text', text: Array.from({ length: 12 }, (_, index) => `Finding ${index}: ${'The summary explains what the investigation found and why. '.repeat(4)}`).join('\n\n') })
    return { ...message, content }
  })
}

function PerformancePreview({ count = 120, paragraphs = 60, tools = false, compact = false, syntax = false, codex = false, reasoning = false, chinese = false, sparseCode = false, claudeTools = false }: { count?: number; paragraphs?: number; tools?: boolean; compact?: boolean; syntax?: boolean; codex?: boolean; reasoning?: boolean; chinese?: boolean; sparseCode?: boolean; claudeTools?: boolean }) {
  const [ready, setReady] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const viewportRef = useRef<HTMLDivElement>(null)
  const scroll = useChatScroll({ scrollViewportRef: viewportRef })
  useEffect(() => {
    const previous = useChatStore.getState()
    const app = useAppStore.getState()
    const messages = claudeTools ? claudeToolHistory(count) : performanceHistory(count, paragraphs, chinese)
    if (codex) messages.splice(1, messages.length - 1, performanceCodexTurn())
    if (reasoning) messages.splice(1, messages.length - 1, reasoningNarrationTurn())
    if (tools) for (const message of messages) {
      if (message.role !== 'assistant') continue
      message.content.unshift(
        { type: 'tool_use', toolUseId: `bash-${message.id}`, toolName: 'Bash', input: JSON.stringify({ command: `echo output-${message.id}` }), status: 'complete' },
        { type: 'tool_result', toolUseId: `bash-${message.id}`, summary: `output-${message.id}` },
      )
    }
    if (compact) messages.splice(Math.floor(count / 2), 0, { id: 'compact', role: 'assistant', providerId: 'system', status: 'complete', createdAt: messages[0].createdAt, content: [{ type: 'text', text: '__compact__:manual:40000:8000:1000' }] })
    if (syntax) messages[messages.length - 1].content = [{ type: 'text', text: [
      '# Semantic markdown',
      '[Reference link][docs]',
      '- Parent\n  - Nested child',
      '| Key | Value |\n| --- | --- |\n| Alpha | Beta |',
      '```ts\nconst answer = 42\n```',
      '$$x^2 + y^2$$',
      ...Array.from({ length: 80 }, (_, index) => `Syntax filler ${index}. ${'A wrapping sentence. '.repeat(8)}`),
      '[docs]: https://example.com/docs',
    ].join('\n\n') }]
    if (sparseCode) messages[messages.length - 1].content = [{ type: 'text', text: Array.from({ length: paragraphs }, (_, index) => [
      `Paragraph ${index}: A reading anchor beside a tall code block.`,
      '```text\n' + Array.from({ length: 30 }, (_, line) => `line ${line}`).join('\n') + '\n```',
    ].join('\n\n')).join('\n\n') + '\n\nFinal reading anchor.' }]
    const project = createDefaultProjectState()
    project._activeSessionId = 'performance'
    project._sessions = { performance: {
      ...createDefaultPerSessionState(),
      sessionProvider: codex || reasoning ? 'codex' : 'claude',
      messages,
    } }
    useChatStore.setState({ activeProject: '__performance__', projectSessions: { ...previous.projectSessions, __performance__: project } })
    useAppStore.setState({ harnessCatalog: null, ...(codex ? { detailChatMode: false } : tools || reasoning ? { detailChatMode: true } : {}) })
    setReady(true)
    return () => {
      useChatStore.setState(previous)
      useAppStore.setState(app)
      useCodexRealtimeViewStore.getState().clearJump('performance')
    }
  }, [count, paragraphs, tools, compact, syntax, codex, reasoning, chinese, sparseCode, claudeTools])

  const appendChunk = () => useChatStore.setState(state => {
    const project = state.projectSessions.__performance__
    const session = project._sessions.performance
    const last = session.messages[session.messages.length - 1]
    const text = last.content.find(block => block.type === 'text')
    const tail: ChatMessage = { ...last, status: 'streaming', content: [{ type: 'text', text: `${text?.type === 'text' ? text.text : ''}\n\n${'New streaming content wraps across the viewport. '.repeat(16)}` }] }
    return { projectSessions: { ...state.projectSessions, __performance__: { ...project, _sessions: { ...project._sessions, performance: { ...session, status: 'streaming', messages: [...session.messages.slice(0, -1), tail] } } } } }
  })

  // A decision composer stands in for the text one, toggled to check the transcript under a hand-off.
  const togglePermission = () => useChatStore.setState(state => {
    const project = state.projectSessions.__performance__
    const session = project._sessions.performance
    const pendingPermissions = session.pendingPermissions.length > 0 ? [] : [{
      requestId: 'perf-permission',
      toolName: 'Bash',
      input: { command: Array.from({ length: 8 }, (_, line) => `bun run step-${line} --filter @superone/desktop`).join(' && \\\n  '), description: 'Build and test the workspace' },
      allowAlwaysAllow: true,
    }]
    return { projectSessions: { ...state.projectSessions, __performance__: { ...project, _sessions: { ...project._sessions, performance: { ...session, pendingPermissions } } } } }
  })

  return <TooltipProvider>
    <div className="flex flex-col gap-3" style={{ width: 760 }}>
      <Button data-perf-toggle onClick={() => setPanelOpen(value => !value)}>Toggle activity panel</Button>
      <div className="flex gap-2">
        <Button data-perf-jump-first onClick={() => useCodexRealtimeViewStore.getState().jumpTo('performance', { view: 'thread', messageId: 'perf-0' })}>Jump to first message</Button>
        <Button data-perf-append-chunk onClick={appendChunk}>Append streaming chunk</Button>
        <Button data-perf-permission onClick={togglePermission}>Toggle permission request</Button>
      </div>
      <div className="flex h-[560px] overflow-hidden rounded-xl border border-border bg-card" data-perf-shell>
        <div className="@container flex min-w-0 flex-1 flex-col" data-perf-chat>
          {ready && <ChatContent scrollViewportRef={viewportRef} {...scroll} foreground={false} />}
        </div>
        <div data-perf-panel style={{ width: panelOpen ? 360 : 0, transition: `width ${ACTIVITY_PANEL_TRANSITION.durationMs}ms ${ACTIVITY_PANEL_TRANSITION.easing}` }} className="shrink-0 overflow-hidden border-l border-border bg-muted/30">
          <div style={{ width: 360 }} className="p-3">Activity panel fixture</div>
        </div>
      </div>
    </div>
  </TooltipProvider>
}

const meta = { title: 'Chat/Transcript Performance', component: PerformancePreview, parameters: { layout: 'padded' } } satisfies Meta<typeof PerformancePreview>
export default meta
type Story = StoryObj<typeof meta>
export const LongHistory: Story = {}
export const ShortHistory: Story = { args: { paragraphs: 1 } }
export const HugeReply: Story = { args: { count: 2, paragraphs: 360 } }
export const ManyTurns: Story = { args: { count: 2000, paragraphs: 1 } }
export const DarkChinese: Story = { globals: { theme: 'dark', locale: 'zh' } }
export const ChineseHistory: Story = { args: { chinese: true }, globals: { theme: 'dark', locale: 'zh' } }
export const SparseCodeHistory: Story = { args: { sparseCode: true } }
export const ClaudeToolTurns: Story = { args: { count: 16, claudeTools: true } }
export const StatefulTools: Story = { args: { paragraphs: 1, tools: true } }
export const CompactedHistory: Story = { args: { paragraphs: 1, compact: true } }
export const SemanticMarkdown: Story = { args: { count: 2, syntax: true } }
export const CodexLongTurn: Story = { args: { count: 2, paragraphs: 1, codex: true } }
export const CodexReasoningNarration: Story = { args: { count: 2, paragraphs: 1, reasoning: true }, globals: { theme: 'dark' } }
