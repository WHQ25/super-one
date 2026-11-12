/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Folder, FolderOpen } from 'lucide-react'
import { describe, expect, it, vi } from 'vitest'
import { SidebarFocusBar } from './SidebarFocusView'

describe('SidebarFocusBar', () => {
  it('switches a sibling and jumps up a level', async () => {
    const onBilling = vi.fn()
    const onCurrent = vi.fn()
    const onExit = vi.fn()
    const user = userEvent.setup()
    render(
      <SidebarFocusBar
        title="Payments"
        siblings={[
          { id: 'payments', label: 'Payments', current: true, icon: <FolderOpen aria-hidden data-testid="open-folder" />, onSelect: onCurrent },
          { id: 'billing', label: 'Billing', icon: <Folder aria-hidden data-testid="closed-folder" />, onSelect: onBilling },
        ]}
        levels={[
          { id: 'root', label: 'Exit Focus', onSelect: onExit },
          { id: 'environment', label: 'Build machine', icon: <span data-testid="level-icon" />, onSelect: vi.fn() },
        ]}
        menuLabel="Select Project"
        onAddProject={vi.fn()}
        actions={<button type="button">Search sessions…</button>}
      />,
    )
    const actions = document.querySelector('[data-sidebar-focus-actions]')
    expect(actions?.className).not.toContain('opacity-0')
    const levelIds = [...document.querySelectorAll('[data-focus-level]')].map((node) => node.getAttribute('data-focus-level'))
    expect(levelIds).toEqual(['environment', 'root'])
    expect(screen.getByRole('button', { name: 'Search sessions…' })).toBeVisible()
    const title = document.querySelector('[data-sidebar-focus-title]')
    expect(title?.className).not.toContain('hover:bg-sidebar-hover')
    expect(title?.className).toContain('hover:text-foreground')
    expect(screen.getByRole('button', { name: 'Build machine', hidden: true }).querySelector('[data-testid="level-icon"]')).toBeTruthy()
    expect(document.querySelector('[data-sidebar-focus-title] [data-testid="open-folder"]')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Exit Focus', hidden: true }))
    expect(onExit).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'Payments' }))
    expect(screen.getByText('Select Project')).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Add Project' })).toBeTruthy()
    expect(document.querySelector('[data-sidebar-focus-title] [data-testid="open-folder"]')).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /Billing/ }).querySelector('[data-testid="closed-folder"]')).toBeTruthy()
    const currentItem = screen.getByRole('menuitem', { name: /Payments/ })
    expect(currentItem.querySelector('[data-testid="open-folder"]')).toBeTruthy()
    expect(currentItem.lastElementChild?.classList.contains('lucide-check')).toBe(true)
    expect(screen.getByRole('menuitem', { name: /Billing/ }).querySelector('.lucide-check')).toBeNull()
    await user.click(screen.getByRole('menuitem', { name: /Billing/ }))
    expect(onBilling).toHaveBeenCalledTimes(1)
    expect(document.activeElement).not.toBe(document.querySelector('[data-sidebar-focus-title]'))
    await user.click(screen.getByRole('button', { name: 'Payments' }))
    await user.click(screen.getByRole('menuitem', { name: /Payments/ }))
    expect(onCurrent).not.toHaveBeenCalled()
  })

  it('renders a lone title as text', () => {
    render(
      <SidebarFocusBar
        title="Only"
        siblings={[{ id: 'only', label: 'Only', current: true, onSelect: vi.fn() }]}
        levels={[{ id: 'root', label: 'Exit Focus', onSelect: vi.fn() }]}
      />,
    )
    expect(screen.getByText('Only').tagName).toBe('SPAN')
  })
})

it('turns the level control into back while the hover menu stays', () => {
  const onBack = vi.fn()
  render(<SidebarFocusBar
    title="desktop"
    siblings={[{ id: 'desktop', label: 'desktop', current: true, icon: <Folder className="size-4" />, onSelect: vi.fn() }]}
    levels={[{ id: 'src', label: 'src', onSelect: vi.fn() }]}
    backLabel="Back to src"
    onBack={onBack}
  />)
  const back = screen.getByRole('button', { name: 'Back to src' })
  expect(screen.queryByRole('button', { name: 'Focus Levels' })).not.toBeInTheDocument()
  expect(back.querySelector('.lucide-list')).toHaveClass('size-4')
  expect(back.querySelector('.lucide-circle-chevron-left')).toHaveClass('hidden', 'size-4')
  expect(document.querySelector('[data-sidebar-focus-title] svg')).toHaveClass('size-4')
  fireEvent.click(back)
  expect(onBack).toHaveBeenCalledOnce()
})

it('opens the focused parent from its title while keeping sibling selection on a separate button', async () => {
  const open = vi.fn()
  const switchSibling = vi.fn()
  const user = userEvent.setup()
  render(<SidebarFocusBar
    title="Parent"
    siblings={[
      { id: 'parent', label: 'Parent', current: true, icon: <FolderOpen />, onSelect: vi.fn() },
      { id: 'sibling', label: 'Sibling parent', onSelect: switchSibling },
    ]}
    levels={[]}
    menuLabel="Select Session"
    onOpenCurrent={open}
  />)
  await user.click(screen.getByRole('button', { name: 'Parent' }))
  expect(open).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('menuitem')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Select Session' }))
  await user.click(screen.getByRole('menuitem', { name: 'Sibling parent' }))
  expect(switchSibling).toHaveBeenCalledTimes(1)
})
