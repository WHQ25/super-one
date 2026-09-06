import { describe, expect, it } from 'vitest'
import { filterProjects } from './project-picker-state'

const projects = [
  { path: '/w/super-one', name: 'super-one' },
  { path: '/w/design-system', name: 'design-system' },
  { path: '/w/superb-notes', name: 'superb-notes' },
]

describe('filterProjects', () => {
  it('keeps the given order when nothing is typed', () => {
    expect(filterProjects(projects, '  ').map((p) => p.name))
      .toEqual(['super-one', 'design-system', 'superb-notes'])
  })

  it('drops the misses and ranks the rest', () => {
    expect(filterProjects(projects, 'design').map((p) => p.name)).toEqual(['design-system'])
    expect(filterProjects(projects, 'zzz')).toEqual([])
  })

  it('ranks a contiguous prefix above a scattered subsequence', () => {
    // `superb-notes` matches `superb` outright; `super-one` only as a subsequence.
    expect(filterProjects(projects, 'superb')[0]!.name).toBe('superb-notes')
  })

  it('returns a copy, never the caller array', () => {
    expect(filterProjects(projects, '')).not.toBe(projects)
  })
})
