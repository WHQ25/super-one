/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EnvironmentSectionHeader } from './EnvironmentSectionHeader'

describe('environment header row', () => {
  it('highlights on hover at the same height and inset as a project row', () => {
    render(
      <EnvironmentSectionHeader
        label="This Mac"
        kind="local"
        connection="connected"
        expanded
        projectsStatus="ready"
        projectsError={null}
        onToggle={() => {}}
      />,
    )
    const row = screen.getByText('This Mac').closest('.group')
    expect(row?.className).toContain('hover:bg-sidebar-hover')
    expect(row?.className).toContain('h-9')
    expect(row?.className).toContain('px-1.5')
    const glyph = document.querySelector('.lucide-monitor')
    const chevron = document.querySelector('.lucide-chevron-right')
    expect(glyph?.getAttribute('class')).toContain('size-full')
    expect(chevron?.getAttribute('class')).toContain('size-full')
    expect(glyph?.parentElement).toBe(chevron?.parentElement)
    expect(glyph?.parentElement?.className).toContain('grid')
    expect(glyph?.parentElement?.className).toContain('size-4')
  })
})

describe('disconnected environment header', () => {
  it('keeps the red cloud, offers only Connect, and does not expand', () => {
    const onToggle = vi.fn()
    render(
      <EnvironmentSectionHeader
        label="build-box"
        kind="cli-node"
        connection="offline"
        expanded
        projectsStatus="error"
        projectsError="socket closed"
        onToggle={onToggle}
        onRefresh={() => {}}
        onToggleConnection={() => {}}
        onAddProject={() => {}}
        onSort={() => {}}
      />,
    )
    expect(document.querySelector('.lucide-unplug')).toBeNull()
    expect(document.querySelector('.lucide-cloud')?.getAttribute('class')).toContain('text-error')
    expect(document.querySelector('.lucide-chevron-right')?.getAttribute('class')).toContain('!hidden')
    expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add Project' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Sort Projects', hidden: true })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    const actions = document.querySelector('[data-slot="environment-row-actions"]')
    expect(actions?.getAttribute('class')).toContain('opacity-0')
    expect(actions?.getAttribute('class')).toContain('invisible')
    expect(actions?.getAttribute('class')).toContain('group-hover:opacity-100')
    expect(screen.getByRole('button', { name: 'Connect', hidden: true })).toBeInTheDocument()
    expect(screen.getByText('build-box').closest('button')).toBeNull()
    fireEvent.click(screen.getByText('build-box'))
    expect(onToggle).not.toHaveBeenCalled()
  })
})
