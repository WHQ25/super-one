/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CodexCommandBlockPresenter } from '@superone/chat-view/presenters/CodexCommandBlock'
import type { CodexCommandExecutionItem } from '@superone/shared/agent-types'

const item: CodexCommandExecutionItem = { id: 'read', type: 'command_execution', cwd: '/repo',
  command: 'cat a.ts b.ts', commandActions: [{ type: 'unknown' }], status: 'completed', exitCode: 0, aggregatedOutput: 'one shared output' }

function mount(command = item) {
  const preview = vi.fn()
  const result = render(<CodexCommandBlockPresenter item={command} isStreaming={false}
    renderFileChip={path => <button onClick={event => { event.stopPropagation(); preview(path) }}>{path}</button>}
    renderAnsiText={text => text} />)
  return { ...result, preview }
}

describe('Codex command details', () => {
  it('uses one command section for all file rows and keeps preview clicks inside the expanded call', () => {
    const { container, preview } = mount()
    expect(screen.getByText('2 files')).toBeInTheDocument()
    fireEvent.click(container.querySelector('.tool-node > div')!)
    expect(screen.queryByText(/one shared output/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '/repo/b.ts' }))
    expect(preview).toHaveBeenCalledWith('/repo/b.ts')
    fireEvent.click(screen.getByRole('button', { name: 'Command' }))
    expect(screen.getAllByText(/one shared output/)).toHaveLength(1)
    expect(screen.getAllByText(/Exit code 0/)).toHaveLength(1)
    expect(container.querySelectorAll('.tool-node')).toHaveLength(1)
  })

  it('preserves all known mixed actions and treats an unknown action as Bash', () => {
    const actions = [{ type: 'read', path: '/repo/a.ts' }, { type: 'search', query: 'TODO', path: '/repo/src' }, { type: 'listFiles', path: '/repo/tests' }]
    const { container, rerender } = mount({ ...item, command: 'opaque', commandActions: actions })
    fireEvent.click(screen.getByText('Code Explored'))
    expect(screen.getByText('Grep')).toBeInTheDocument()
    expect(screen.getByText('LS')).toBeInTheDocument()
    expect(screen.getByText('TODO in /repo/src')).toBeInTheDocument()
    rerender(<CodexCommandBlockPresenter item={{ ...item, command: 'cat a.ts && rm b.ts', commandActions: [...actions, { type: 'unknown', command: 'rm b.ts' }] }}
      isStreaming={false} renderFileChip={path => path} renderAnsiText={text => text} />)
    expect(screen.getByText('Bash')).toBeInTheDocument()
    expect(container.querySelectorAll('.tool-node')).toHaveLength(1)
  })
})
