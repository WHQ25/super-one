/** @vitest-environment jsdom */

import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UserSelectionChip } from './UserSelectionChip'

let mockCurrentFolder: string | null = null
vi.mock('@/stores/app', () => ({
  useEffectiveProjectRoot: () => mockCurrentFolder,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { count?: number }) => {
      const map: Record<string, string> = {
        'chat.userSelectionChip.title': `${opts?.count ?? 0} 处引用`,
        'chat.userSelectionChip.popoverTitle': `引用 (${opts?.count ?? 0})`,
      }
      return map[key] ?? key
    },
  }),
}))

describe('UserSelectionChip', () => {
  beforeEach(() => {
    mockCurrentFolder = null
  })

  it('renders nothing when there are no selections', () => {
    const { container } = render(<UserSelectionChip selections={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders trigger as a file chip (basename + range, no full path)', () => {
    render(<UserSelectionChip selections={['/abs/path/foo.ts:L10-L12\nconst a = 1\nconst b = 2\nconst c = 3']} />)
    expect(screen.getAllByText('foo.ts').length).toBeGreaterThan(0)
    expect(screen.getAllByText('L10-L12').length).toBeGreaterThan(0)
    expect(screen.queryByText(/\/abs\/path\/foo\.ts/)).toBeNull()
  })

  it('opens popover and shows file chip header (no full path) per quote', () => {
    render(<UserSelectionChip selections={['/abs/path/foo.ts:L10-L11:C5-C8\nconst a = 1\nconst b = 2']} />)
    act(() => {
      screen.getByRole('button', { name: /foo.ts/ }).click()
    })
    const fooMatches = screen.getAllByText('foo.ts')
    expect(fooMatches.length).toBeGreaterThanOrEqual(2)
    const rangeMatches = screen.getAllByText('L10-L11')
    expect(rangeMatches.length).toBeGreaterThanOrEqual(2)
    expect(screen.queryByText(/\/abs\/path\/foo\.ts/)).toBeNull()
  })

  it('falls back to Quote icon + plain pre rendering for quotes without a file prefix', () => {
    const { container } = render(<UserSelectionChip selections={['some plain quote with no prefix']} />)
    act(() => {
      screen.getByRole('button', { name: /some plain quote/ }).click()
    })
    const pre = container.ownerDocument.body.querySelector('pre')
    expect(pre?.textContent).toBe('some plain quote with no prefix')
  })

  it('handles Windows-style backslash paths and shows just the basename', () => {
    render(<UserSelectionChip selections={['C:\\Users\\foo\\bar.ts:L1-L2\nline1\nline2']} />)
    expect(screen.getAllByText('bar.ts').length).toBeGreaterThan(0)
    expect(screen.queryByText(/Users/)).toBeNull()
  })
})
