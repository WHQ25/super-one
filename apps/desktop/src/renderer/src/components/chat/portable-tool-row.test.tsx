/** @vitest-environment jsdom */

import { render, screen, fireEvent, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PortableToolRow } from '@superone/chat-view/PortableToolRow'
import { FileChip } from './FileChip'

/**
 * The WebView row the phone renders. It is the same presenter the desktop runs, so what
 * matters here is the half the desktop never exercises: a projected input that carries a
 * target but no content, with the edited body arriving as precomputed `toolDiff` instead.
 */
describe('portable tool row', () => {
  it('keeps a command running as partial output arrives and finishes only on completion', () => {
    const row = (result: string, status: 'streaming' | 'complete') => <PortableToolRow
      toolName="Bash" toolUseId="live-command" input='{"command":"build"}' result={result} status={status} />
    const view = render(row('first line', 'streaming'))
    expect(screen.getByText('Running…')).toBeInTheDocument()
    fireEvent.click(view.container.querySelector('.tool-node > div')!)
    expect(screen.getByText(/first line/)).toBeInTheDocument()
    view.rerender(row('first line\nsecond line', 'streaming'))
    expect(screen.getByText('Running…')).toBeInTheDocument()
    expect(screen.getByText(/second line/)).toBeInTheDocument()
    view.rerender(row('first line\nsecond line', 'complete'))
    expect(screen.queryByText('Running…')).not.toBeInTheDocument()
    expect(screen.getByText(/second line/)).toBeInTheDocument()
  })

  it('names a Read by its file even though the phone gets only the projected path', () => {
    render(
      <PortableToolRow
        toolName="Read"
        toolUseId="read-1"
        input={JSON.stringify({ file_path: '/repo/src/session.ts', offset: 20, limit: 40 })}
        status="complete"
      />,
    )

    // The desktop row shows a file chip plus the line range, not a bare tool name.
    expect(screen.getByText('session.ts')).toBeInTheDocument()
    expect(screen.getByText('L20–59')).toBeInTheDocument()
  })

  it.each(['Read', 'Skill'])('keeps a deferred %s collapsed like the desktop, which never shows its body', (toolName) => {
    const { container } = render(
      <PortableToolRow
        toolName={toolName}
        toolUseId={`${toolName}-deferred`}
        input={JSON.stringify({ file_path: '/repo/src/session.ts', skill: 'release' })}
        status="complete"
        result="file contents"
        hasDeferredDetails
      />,
    )

    expect(container.querySelector('.tool-node')).not.toHaveClass('cursor-pointer')
    expect(container.querySelector('.lucide-chevron-right')).toBeNull()
  })

  it('dresses the file chip exactly like the desktop one, icon included', () => {
    const portable = render(
      <PortableToolRow
        toolName="Read"
        toolUseId="read-2"
        input={JSON.stringify({ file_path: '/repo/src/session.ts' })}
        status="complete"
      />,
    )
    const chip = within(portable.container).getByText('session.ts').closest('[role="button"]')!
    const desktop = render(<FileChip name="session.ts" title="session.ts" filePath="/repo/src/session.ts" />)
    const desktopChip = within(desktop.container).getByText('session.ts').closest('[role="button"]')!

    // Same shell — the phone used to print a mono, primary-coloured, icon-less button.
    expect(chip.className).toBe(desktopChip.className)
    expect(chip.querySelector('svg')).not.toBeNull()
  })

  it('draws an Edit from the transmitted diff when the bodies were stripped', () => {
    const { container } = render(
      <PortableToolRow
        toolName="Edit"
        toolUseId="edit-1"
        input={JSON.stringify({ file_path: '/repo/src/app.ts' })}
        status="complete"
        toolDiff={'-const enabled = false\n+const enabled = true'}
        toolLineDelta={{ added: 1, removed: 1 }}
      />,
    )

    expect(screen.getByText('app.ts')).toBeInTheDocument()
    // `computeLineDelta` cannot derive this without old_string/new_string — the counts
    // have to come from the delta the desktop precomputed.
    expect(container.querySelector('.text-success')?.textContent).toBe('+1')
    expect(container.querySelector('.text-error')?.textContent).toBe('-1')

    // The file chip stops propagation so tapping it opens the file; expanding is the row.
    fireEvent.click(container.querySelector('.tool-node > div')!)
    expect(screen.getByText('const enabled = true')).toBeInTheDocument()
    expect(screen.getByText('const enabled = false')).toBeInTheDocument()
  })

  it('keeps the header delta on a deferred Edit and does not dump raw params after expand', () => {
    const { container } = render(
      <PortableToolRow
        toolName="Edit"
        toolUseId="edit-deferred"
        input={JSON.stringify({
          file_path: '/repo/src/app.ts',
          old_string: 'const enabled = false',
          new_string: 'const enabled = true',
        })}
        status="complete"
        toolDiff={'-const enabled = false\n+const enabled = true'}
        toolLineDelta={{ added: 1, removed: 1 }}
        hasDeferredDetails
      />,
    )

    expect(container.querySelector('.text-success')?.textContent).toBe('+1')
    expect(container.querySelector('.text-error')?.textContent).toBe('-1')
    expect(container.textContent).not.toContain('old_string')
    expect(container.textContent).not.toContain('new_string')

    fireEvent.click(container.querySelector('.tool-node > div')!)
    expect(screen.getByText('const enabled = true')).toBeInTheDocument()
    expect(screen.getByText('const enabled = false')).toBeInTheDocument()
    expect(container.textContent).not.toContain('old_string')
    expect(container.textContent).not.toContain('new_string')
  })

  it('shows a Write header delta without expanding onto the file body JSON', () => {
    const { container } = render(
      <PortableToolRow
        toolName="Write"
        toolUseId="write-deferred"
        input={JSON.stringify({ file_path: '/repo/docs/note.md', content: '# Title\n\nBody' })}
        status="complete"
        toolDiff={'+# Title\n+\n+Body'}
        toolLineDelta={{ added: 3, removed: 0 }}
        hasDeferredDetails
      />,
    )

    expect(container.querySelector('.text-success')?.textContent).toBe('+3')
    expect(container.textContent).not.toContain('"content"')
    fireEvent.click(container.querySelector('.tool-node > div')!)
    expect(screen.getByText('# Title')).toBeInTheDocument()
    expect(container.textContent).not.toContain('"content"')
  })

  it('shows a FileChange header delta without dumping the patch JSON', () => {
    const { container } = render(
      <PortableToolRow
        toolName="FileChange"
        toolUseId="change-deferred"
        input={JSON.stringify({ file_path: '/repo/a.ts', kind: 'update', diff: 'huge patch body' })}
        status="complete"
        toolDiff={'@@ -1 +1 @@\n-old line\n+new line'}
        toolLineDelta={{ added: 1, removed: 1 }}
        hasDeferredDetails
      />,
    )

    expect(container.querySelector('.text-success')?.textContent).toBe('+1')
    expect(container.querySelector('.text-error')?.textContent).toBe('-1')
    expect(container.textContent).not.toContain('huge patch body')
    fireEvent.click(container.querySelector('.tool-node > div')!)
    expect(screen.getByText('new line')).toBeInTheDocument()
    expect(container.textContent).not.toContain('huge patch body')
  })

  it('renders Bash as the terminal view, with the transported tail as its output', () => {
    const { container } = render(
      <PortableToolRow
        toolName="Bash"
        toolUseId="bash-1"
        input={JSON.stringify({ command: 'bun run typecheck' })}
        // The transport sends output only; the presenter owns the command line.
        result={'Exited with code 0'}
        status="complete"
      />,
    )

    expect(screen.getByText('bun run typecheck')).toBeInTheDocument()
    fireEvent.click(container.querySelector('.tool-node > div')!)
    // Terminal chrome, not the generic row's plain <pre> result dump.
    expect(container.querySelector('.bg-terminal-bg')).not.toBeNull()
    expect(screen.getByText(/Exited with code 0/)).toBeInTheDocument()
    expect(container.textContent?.match(/bun run typecheck/g)).toHaveLength(1)
  })

  it('keeps a Grok Bash description in the deferred header and expands to a terminal', () => {
    const onExpandedChange = vi.fn()
    const { container } = render(
      <PortableToolRow
        toolName="Bash"
        toolUseId="grok-bash"
        input={JSON.stringify({ command: 'ls -la', description: 'List workspace files' })}
        // ACP titles must not replace the agent-written description in the header.
        toolSummary="Run Command"
        result={'file.ts\nreadme.md'}
        status="complete"
        hasDeferredDetails
        onExpandedChange={onExpandedChange}
      />,
    )

    expect(screen.getByText('List workspace files')).toBeInTheDocument()
    expect(container.textContent).not.toContain('Run Command')
    expect(container.querySelector('.bg-terminal-bg')).toBeNull()

    fireEvent.click(container.querySelector('.tool-node > div')!)
    expect(onExpandedChange).toHaveBeenCalledWith(true)
    expect(container.querySelector('.bg-terminal-bg')).not.toBeNull()
    expect(screen.getByText('ls -la')).toBeInTheDocument()
    expect(screen.getByText(/file.ts/)).toBeInTheDocument()
    expect(container.textContent).not.toContain('"command"')
    expect(container.textContent).not.toContain('"description"')
    expect(container.textContent).not.toContain('"role"')
  })

  it('shows a deferred browser description in the header without dumping args JSON', () => {
    const { container } = render(
      <PortableToolRow
        toolName="mcp__superone__browser_snapshot"
        toolUseId="shot"
        input={JSON.stringify({ include: ['screenshot'], description: 'Google home' })}
        toolSummary="Google home"
        status="complete"
        hasDeferredDetails
      />,
    )

    expect(screen.getByText('Google home')).toBeInTheDocument()
    fireEvent.click(container.querySelector('.tool-node > div')!)
    expect(container.textContent).not.toContain('"include"')
  })

  it('keeps a deferred Grep header from the pattern and does not dump args JSON', () => {
    const { container } = render(
      <PortableToolRow
        toolName="Grep"
        toolUseId="grep-deferred"
        input={JSON.stringify({ pattern: 'TODO', path: '/repo/src' })}
        toolSummary="TODO in src"
        result={'src/a.ts:1:TODO fix this'}
        status="complete"
        hasDeferredDetails
      />,
    )

    expect(screen.getByText('TODO in src')).toBeInTheDocument()
    fireEvent.click(container.querySelector('.tool-node > div')!)
    expect(screen.getByText(/src\/a.ts:1:TODO fix this/)).toBeInTheDocument()
    expect(container.textContent).not.toContain('"pattern"')
  })

  it('names a mini-app call by its app and tool', () => {
    render(
      <PortableToolRow
        toolName="mcp__superone__miniapp_call"
        toolUseId="app-1"
        input={JSON.stringify({ appId: 'notes', tool: 'create_note' })}
        result={JSON.stringify({ ok: true })}
        status="complete"
      />,
    )

    expect(screen.getByText('notes')).toBeInTheDocument()
    expect(screen.getByText('create note')).toBeInTheDocument()
  })

  it('falls back to the shared row when the mini-app projection lost its identity', () => {
    const { container } = render(
      <PortableToolRow
        toolName="mcp__superone__miniapp_call"
        toolUseId="app-2"
        input=""
        result={JSON.stringify({ ok: true })}
        status="complete"
      />,
    )

    // Not an empty render: the generic MCP row still names the server and the tool.
    expect(container.querySelector('.tool-node')).not.toBeNull()
    expect(container.textContent).toContain('superone')
    expect(container.textContent).toContain('miniapp call')
  })
})

it.each(['$ ls\nactual output', '\x1b[32m$\x1b[0m another-command\nactual output'])(
  'preserves output that is not the exact legacy echo: %j', (result) => {
    const { container } = render(<PortableToolRow toolName="Bash" toolUseId="preserve" input='{"command":"ls"}' result={result} status="complete" />)
    fireEvent.click(container.querySelector('.tool-node > div')!)
    for (const line of result.replace(/\x1b\[[0-9;]*m/g, '').split('\n')) {
      expect(container.textContent).toContain(line)
    }
  },
)
