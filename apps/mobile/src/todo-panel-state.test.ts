import { describe, expect, it } from 'vitest'
import type { TodoItem } from '@superone/shared/agent-types'
import { buildTodoPanelRows, todoPanelSummary } from './todo-panel-state'

function todo(overrides: Partial<TodoItem> & Pick<TodoItem, 'id'>): TodoItem {
  return { subject: `Todo ${overrides.id}`, description: '', status: 'pending', ...overrides }
}

function map(...items: TodoItem[]): Record<string, TodoItem> {
  return Object.fromEntries(items.map((item) => [item.id, item]))
}

describe('buildTodoPanelRows', () => {
  it('shows the active form only while a todo runs', () => {
    const rows = buildTodoPanelRows(map(
      todo({ id: '1', subject: 'Ship the panel', activeForm: 'Shipping the panel', status: 'in_progress' }),
      todo({ id: '2', subject: 'Write the tests', activeForm: 'Writing the tests' }),
    ))
    expect(rows.map((row) => row.text)).toEqual(['Shipping the panel', 'Write the tests'])
  })

  it('falls back to the subject when a running todo has no active form', () => {
    const rows = buildTodoPanelRows(map(todo({ id: '1', subject: 'Ship it', status: 'in_progress' })))
    expect(rows[0].text).toBe('Ship it')
  })

  it('merges the inverse `blocks` edges into the blocked row', () => {
    const rows = buildTodoPanelRows(map(
      todo({ id: '1', blocks: ['3'] }),
      todo({ id: '2' }),
      todo({ id: '3', blockedBy: ['2'] }),
    ))
    expect(rows.find((row) => row.id === '3')?.blockers).toEqual(['2', '1'])
  })

  it('drops completed and unknown blockers', () => {
    const rows = buildTodoPanelRows(map(
      todo({ id: '1', status: 'completed' }),
      todo({ id: '2', blockedBy: ['1', 'ghost'] }),
    ))
    expect(rows.find((row) => row.id === '2')?.blockers).toEqual([])
  })

  it('deduplicates a blocker declared from both directions', () => {
    const rows = buildTodoPanelRows(map(
      todo({ id: '1', blocks: ['2'] }),
      todo({ id: '2', blockedBy: ['1'] }),
    ))
    expect(rows.find((row) => row.id === '2')?.blockers).toEqual(['1'])
  })

  it('keeps a running description open and hides any other behind the chevron', () => {
    const rows = buildTodoPanelRows(map(
      todo({ id: '1', description: 'Reading the reducer', status: 'in_progress' }),
      todo({ id: '2', description: 'Needs a fixture' }),
      todo({ id: '3' }),
    ))
    expect(rows.map((row) => [row.autoDescription, row.expandable])).toEqual([
      [true, false],
      [false, true],
      [false, false],
    ])
  })

  it('treats empty description and owner strings as absent', () => {
    const rows = buildTodoPanelRows(map(todo({ id: '1', description: '', owner: '' })))
    expect(rows[0].description).toBeUndefined()
    expect(rows[0].owner).toBeUndefined()
    expect(rows[0].expandable).toBe(false)
  })
})

describe('todoPanelSummary', () => {
  it('counts completed rows and flags a running one', () => {
    const rows = buildTodoPanelRows(map(
      todo({ id: '1', status: 'completed' }),
      todo({ id: '2', status: 'in_progress' }),
      todo({ id: '3' }),
    ))
    expect(todoPanelSummary(rows)).toEqual({ completed: 1, total: 3, hasInProgress: true })
  })

  it('reports an all-done list with no running row', () => {
    const rows = buildTodoPanelRows(map(todo({ id: '1', status: 'completed' })))
    expect(todoPanelSummary(rows)).toEqual({ completed: 1, total: 1, hasInProgress: false })
  })
})
