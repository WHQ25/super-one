/** @vitest-environment jsdom */

import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PortableToolRow } from '@superone/chat-view/PortableToolRow'

/**
 * The WebView row the phone renders. It is the same presenter the desktop runs, so what
 * matters here is the half the desktop never exercises: a projected input that carries a
 * target but no content, with the edited body arriving as precomputed `toolDiff` instead.
 */
describe('portable tool row', () => {
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

  it('renders Bash as the terminal view, with the transported tail as its output', () => {
    const { container } = render(
      <PortableToolRow
        toolName="Bash"
        toolUseId="bash-1"
        input={JSON.stringify({ command: 'bun run typecheck' })}
        // `bash_result` arrives with the command echo already prefixed by the desktop.
        result={'[32m$[0m bun run typecheck\nExited with code 0'}
        status="complete"
      />,
    )

    expect(screen.getByText('bun run typecheck')).toBeInTheDocument()
    fireEvent.click(container.querySelector('.tool-node > div')!)
    // Terminal chrome, not the generic row's plain <pre> result dump.
    expect(container.querySelector('.bg-terminal-bg')).not.toBeNull()
    expect(screen.getByText(/Exited with code 0/)).toBeInTheDocument()
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
