/** @vitest-environment jsdom */

import { render, fireEvent, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PortableMessage } from '@superone/chat-view/PortableMessage'
import { applyContentDelta } from '@superone/shared/content-delta'
import type { ChatMessage, ContentBlock } from '@superone/shared/agent-types'

/**
 * What the phone actually receives for a Bash call: the invocation typed as
 * `bash` rather than `tool_use`, and the outcome rewritten into `bash_result` so
 * the output and tokenised ANSI survive the strip. Built through the real
 * reducer, because the bug lived in the seam between it and the grouping pass —
 * handing the presenter a hand-assembled `content` array hides it entirely.
 */
function bashTurn(): ChatMessage {
  const call = {
    type: 'bash',
    toolName: 'Bash',
    toolUseId: 'bash-1',
    status: 'streaming',
    input: JSON.stringify({ command: 'ls -la' }),
  } as ContentBlock
  const result = {
    type: 'bash_result',
    toolUseId: 'bash-1',
    summary: `total 4\nfoo.ts`,
  } as ContentBlock

  return {
    id: 'turn-1',
    role: 'assistant',
    status: 'streaming',
    createdAt: '2026-01-01T00:00:00.000Z',
    providerId: 'claude',
    content: applyContentDelta([call], result),
  } as ChatMessage
}

describe('projected tool results on the phone', () => {
  it('folds a bash_result into its row instead of leaving a second block', () => {
    const { container } = render(
      <PortableMessage
        message={bashTurn()}
        scheme="dark"
        pendingPermission={null}
        isLastAssistant
        sessionStreaming
      />,
    )

    // One row — not a "Running…" row plus a detached result underneath it.
    expect(container.querySelectorAll('.tool-node')).toHaveLength(1)
    expect(within(container).queryByText('Running…')).toBeNull()

    fireEvent.click(container.querySelector('.tool-node > div')!)
    expect(container.textContent).toContain('foo.ts')
    expect(container.textContent?.match(/ls -la/g)).toHaveLength(1)
  })

  it('stops shimmering once the result lands mid-stream', () => {
    // A call only leaves `streaming` when a matching result arrives, and the
    // projection renamed the one block that could deliver it.
    const message = bashTurn()
    expect((message.content[0] as { status?: string }).status).toBe('complete')

    const { container } = render(
      <PortableMessage
        message={message}
        scheme="dark"
        pendingPermission={null}
        isLastAssistant
        sessionStreaming
      />,
    )
    expect(container.querySelector('.animate-shimmer')).toBeNull()
  })

  it('draws one row for a call that is opened empty and filled by a later delta', () => {
    // Claude opens a tool block with an empty input, then sends the real one.
    // Both arrive typed `bash`, so a reducer matching only `tool_use` appended
    // them side by side: the same command twice, the first without a summary.
    const content = [
      { type: 'bash', toolName: 'Bash', toolUseId: 'bash-1', input: '', status: 'streaming' } as ContentBlock,
      { type: 'bash', toolName: 'Bash', toolUseId: 'bash-1', status: 'streaming',
        input: JSON.stringify({ command: 'ls -la' }) } as ContentBlock,
    ].reduce<ContentBlock[]>((acc, delta) => applyContentDelta(acc, delta), [])
    const { container } = render(
      <PortableMessage
        message={{ ...bashTurn(), content }}
        scheme="dark"
        pendingPermission={null}
        isLastAssistant
        sessionStreaming
      />,
    )

    expect(container.querySelectorAll('.tool-node')).toHaveLength(1)
    expect(container.textContent).toContain('ls -la')
  })
})

it('renders a Codex shell command before output arrives and updates it in place', () => {
  const message: ChatMessage = {
    id: 'codex-turn', role: 'assistant', status: 'streaming', createdAt: '', providerId: 'codex', content: [],
    metadata: { codex: { threadId: 'thread', usage: null, items: [
      { id: 'shell', type: 'command_execution', command: 'bun run build', aggregatedOutput: '', status: 'in_progress' },
    ] } },
  }
  const props = { scheme: 'dark' as const, pendingPermission: null, isLastAssistant: true, sessionStreaming: true }
  const { container, rerender } = render(<PortableMessage message={message} {...props} />)
  const row = container.querySelector('[data-tool-use-id="shell"]')
  expect(row).not.toBeNull()
  fireEvent.click(row!.querySelector('div')!)
  expect(container.textContent).toContain('bun run build')
  expect(row!.querySelector('.animate-shimmer')).not.toBeNull()
  const update = (output: string, complete: boolean): ChatMessage => ({
    ...message, metadata: { codex: { ...message.metadata!.codex!, items: [
      { id: 'shell', type: 'command_execution', command: 'bun run build', aggregatedOutput: output,
        status: complete ? 'completed' : 'in_progress', ...(complete ? { exitCode: 0 } : {}) },
    ] } },
  })
  rerender(<PortableMessage message={update('Building…', false)} {...props} />)
  expect(container.querySelector('[data-tool-use-id="shell"]')).toBe(row)
  expect(row!.textContent).toContain('Building…')
  rerender(<PortableMessage message={update('Build complete', true)} {...props} />)
  expect(row!.textContent).toContain('Build complete')
  expect(row!.querySelector('.animate-shimmer')).toBeNull()
})

it.each(['projected', 'codex'])('renders a historical %s command echo only once', (format) => {
  const command = '/bin/zsh -lc "git status --short"'
  const output = `\x1b[32m$\x1b[0m ${command}\n M README.md`
  const message: ChatMessage = {
    id: 'history', role: 'assistant', status: 'complete', createdAt: '', providerId: 'codex',
    content: format === 'projected' ? [
      { type: 'bash', toolName: 'Bash', toolUseId: 'history-shell', input: JSON.stringify({ command }), status: 'complete' } as ContentBlock,
      { type: 'bash_result', toolUseId: 'history-shell', summary: output },
    ] : [],
    ...(format === 'codex' ? { metadata: { codex: { threadId: 'thread', usage: null, items: [
      { id: 'history-shell', type: 'command_execution' as const, command, aggregatedOutput: output, status: 'completed' as const, exitCode: 0 },
    ] } } } : {}),
  }
  const { container } = render(<PortableMessage message={message} scheme="dark" pendingPermission={null} />)
  const row = container.querySelector('[data-tool-use-id="history-shell"]')!
  expect(row).not.toBeNull()
  fireEvent.click(row.querySelector('div')!)
  expect(row.textContent?.split(command)).toHaveLength(2)
  expect(row.textContent).toContain(' M README.md')
})
