/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { RecentFolder } from '@superone/shared/agent-types'
import { EditProjectDialog } from './EditProjectDialog'

const project: RecentFolder = {
  id: 'p1',
  name: 'super-one',
  path: '/Users/a/src/super-one',
  addedAt: '2026-10-09T00:00:00.000Z',
  lastOpened: '2026-10-09T00:00:00.000Z',
  extraDirs: ['/Users/a/src/super-one/packages/ui', '/Users/a/src/super-one'],
}

describe('edit project dialog', () => {
  it('lists the project root first with a primary badge and keeps it when an extra folder is removed', () => {
    render(<EditProjectDialog target={project} onClose={vi.fn()} onSaved={vi.fn()} />)
    const primary = screen.getByText('~/src/super-one')
    expect(primary.closest('div')?.parentElement?.textContent).toContain('Primary')
    expect(screen.getAllByText('~/src/super-one')).toHaveLength(1)
    expect(screen.getByText('~/src/super-one/packages/ui')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Remove Folder' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Remove Folder' }))
    expect(screen.queryByText('~/src/super-one/packages/ui')).toBeNull()
    expect(screen.getByText('Primary')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove Folder' })).toBeNull()
  })
})
