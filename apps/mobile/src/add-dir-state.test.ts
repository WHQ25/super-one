import { expect, test } from 'vitest'
import { browseSections } from './add-dir-state'

const ENTRIES = [
  { name: 'node_modules', path: '/Users/dev/node_modules' },
  { name: 'design-system', path: '/Users/dev/design-system' },
  { name: 'docs', path: '/Users/dev/docs' },
]

test('a trailing separator means the whole listing, unfiltered', () => {
  const [directories] = browseSections(ENTRIES, '~/Developer/')

  expect(directories.rows.map((row) => row.label)).toEqual(['node_modules', 'design-system', 'docs'])
})

test('the segment after the last separator ranks the listing', () => {
  // This is the reuse that matters: the field is the path *and* the filter, so
  // the page needs no second search box.
  const [directories] = browseSections(ENTRIES, '~/Developer/des')

  expect(directories.rows[0].label).toBe('design-system')
  expect(directories.rows[0].matchIndices).toEqual([0, 1, 2])
  // Subsequence matching, as everywhere else in the shell: `node_modules`
  // contains d…e…s and survives, ranked below a prefix hit. `docs` does not.
  expect(directories.rows.map((row) => row.label)).not.toContain('docs')
})

test('rows are keyed by name so tapping appends to whatever prefix was typed', () => {
  // Keying by absolute path would replace `~/Dev` with its expansion and lose
  // the shorthand the user is typing in.
  const [directories] = browseSections(ENTRIES, '~/')

  expect(directories.rows.map((row) => row.key)).toEqual(['node_modules', 'design-system', 'docs'])
})

