/** @vitest-environment jsdom */

import { act, fireEvent, render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createDetailClient, type DetailUpdate } from '@superone/chat-core'
import { DetailScopeProvider } from '@superone/chat-view/detail-scope'
import { ToolBlock } from './ToolBlock'

// The real view draws on a canvas; list its lines as text instead.
vi.mock('@/lib/diff-utils', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  DiffView: ({ lines }: { lines: { text: string }[] }) => <pre>{lines.map(line => line.text).join('\n')}</pre>,
}))

/**
 * A summarized Codex file change keeps only its path in the row; expanding it loads the
 * patch from the session's detail, which carries the body as `toolDiff`.
 */
const DETAIL = JSON.stringify({
  input: JSON.stringify({ file_path: 'src/a.ts', kind: 'update' }),
  result: '',
  toolDiff: '@@ -1 +1 @@\n-before line\n+after line\n',
})

function renderSummarizedRow() {
  const client = createDetailClient({
    subscribe: async (_target, subscriptionId) => ({ subscriptionId, revision: 0, offset: 0, text: DETAIL }) as DetailUpdate,
    unsubscribe: () => {},
  }, { newId: () => 'detail-1' })
  return render(
    <DetailScopeProvider scope={{ client, environmentId: 'node', sessionId: 'session' }}>
      <ToolBlock toolName="FileChange" toolUseId="patch:0" input={JSON.stringify({ file_path: 'src/a.ts', kind: 'update' })}
        status="complete" remoteDetail={JSON.stringify(['turn', 'tool', 'patch:0'])} />
    </DetailScopeProvider>,
  )
}

describe('a summarized file change on the desktop', () => {
  it('shows the patch from its detail once opened', async () => {
    const { container } = renderSummarizedRow()
    await act(async () => { fireEvent.click(container.querySelector('.tool-node-header')!) })
    await waitFor(() => expect(container.textContent).toContain('after line'))
    expect(container.textContent).toContain('before line')
  })
})
