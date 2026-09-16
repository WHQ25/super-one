/** @vitest-environment jsdom */

import { act, fireEvent, render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PortableMessage } from '@superone/chat-view/PortableMessage'
import type { ChatMessage, ContentBlock } from '@superone/shared/agent-types'

/**
 * Grok's launch receipt: the `tool_result` of a background workflow, which lands
 * seconds after the call while the run itself goes on for minutes.
 */
const RECEIPT = JSON.stringify({
  type: 'Workflow',
  run_id: 'wf_01a0a9',
  task_id: 'wf_01a0a9',
  name: 'grok-build-parity',
  script_path: '/Users/x/.grok/sessions/p/s/workflows/wf_01a0a9/script.rhai',
  message: "Workflow 'grok-build-parity' started in the background.",
})

/** The collapsed shell the desktop projects to the phone, plus whatever the reducers patched on. */
function workflowTurn(shell: Partial<ContentBlock>, result?: ContentBlock, status: 'streaming' | 'complete' = 'complete'): ChatMessage {
  return {
    id: 'turn-1',
    role: 'assistant',
    status,
    createdAt: '2026-01-01T00:00:00.000Z',
    providerId: 'acp',
    content: [
      {
        type: 'tool_use',
        toolName: 'Workflow',
        toolUseId: 'call-wf',
        input: JSON.stringify({ source: { type: 'name', name: 'grok-build-parity' } }),
        status: 'complete',
        ...shell,
      } as ContentBlock,
      ...(result ? [result] : []),
    ],
  } as ChatMessage
}

function renderTurn(message: ChatMessage, sessionStreaming = false) {
  return render(
    <PortableMessage message={message} scheme="dark" pendingPermission={null} isLastAssistant sessionStreaming={sessionStreaming} />,
  )
}

async function expandCard(container: HTMLElement): Promise<HTMLElement> {
  const card = container.querySelector<HTMLElement>('.workflow-container')!
  expect(card).not.toBeNull()
  await act(async () => { fireEvent.click(card.querySelector('button')!) })
  return card
}

describe('workflow card on the phone', () => {
  it('treats the launch receipt as "started", not "finished", and never shows it as output', async () => {
    const { container } = renderTurn(workflowTurn(
      {
        taskSummary: 'grok-build-parity: phase Catalog · 3 agents',
        taskDescription: 'grok-build-parity: gap SuperOne ACP host coverage',
        workflowCurrentPhase: 'Catalog',
        workflowPhases: [{ title: 'Source', state: 'done' }, { title: 'Catalog', state: 'active' }, { title: 'Plan', state: 'pending' }],
        workflowAgents: [{ label: 'cataloger', toolCount: 4, tokens: 12_000, state: 'running' }],
        taskUsage: { totalTokens: 12_000, toolUses: 4, durationMs: 90_000 },
      },
      { type: 'tool_result', toolUseId: 'call-wf', summary: RECEIPT },
    ))
    expect(container.textContent).toContain('Workflow: grok-build-parity')
    // Name prefix stripped from the progress description, like the desktop header.
    expect(container.textContent).toContain('gap SuperOne ACP host coverage')
    expect(container.textContent).toContain('Catalog')
    expect(container.textContent).not.toContain('Workflow complete')
    const card = await expandCard(container)
    expect(card.textContent).toContain('Source')
    expect(card.textContent).toContain('cataloger')
    expect(card.textContent).toContain('phase Catalog · 3 agents')
    expect(card.textContent).not.toContain('started in the background')
    expect(card.textContent).not.toContain('Output')
  })

  it('completes only on taskStatus and shows the run result, with the receipt still hidden', async () => {
    const { container } = renderTurn(workflowTurn(
      {
        taskStatus: 'completed',
        taskSummary: 'Plan written',
        taskResultText: 'Wrote docs/design/parity-plan.md',
        workflowPhases: [{ title: 'Source', state: 'done' }, { title: 'Plan', state: 'done' }],
        taskUsage: { totalTokens: 40_000, toolUses: 20, durationMs: 300_000 },
      },
      { type: 'tool_result', toolUseId: 'call-wf', summary: RECEIPT },
    ))
    const card = await expandCard(container)
    expect(card.textContent).toContain('Workflow complete')
    expect(card.textContent).toContain('5m')
    await act(async () => { fireEvent.click(Array.from(card.querySelectorAll('button')).find((b) => b.textContent === 'Output')!) })
    expect(card.textContent).toContain('Wrote docs/design/parity-plan.md')
    expect(card.textContent).not.toContain('wf_01a0a9')
  })

  it('reports a failed launch as failed instead of spawning forever', async () => {
    const { container } = renderTurn(workflowTurn(
      {},
      { type: 'tool_result', toolUseId: 'call-wf', summary: 'Tool `workflow` failed: workflow path is not trusted', isError: true },
    ))
    expect(container.textContent).not.toContain('Starting workflow')
    const card = await expandCard(container)
    expect(card.textContent).toContain('Workflow failed')
    await act(async () => { fireEvent.click(Array.from(card.querySelectorAll('button')).find((b) => b.textContent === 'Output')!) })
    expect(card.textContent).toContain('workflow path is not trusted')
  })

  it('shows the declared meta of a Claude script while the launch is still in flight', () => {
    const { container } = renderTurn(workflowTurn({
      input: '',
      workflowName: 'review-changes',
      workflowDescription: 'Review changed files across dimensions',
      workflowPhases: [{ title: 'Review', detail: 'one agent per dimension' }, { title: 'Verify' }],
      status: 'streaming',
    }, undefined, 'streaming'), true)
    expect(container.textContent).toContain('Workflow: review-changes')
    expect(container.textContent).toContain('Review changed files across dimensions')
    expect(container.textContent).not.toContain('Starting workflow')
  })
})
