import { expect, jest, test } from '@jest/globals'
import { fireEvent, screen } from '@testing-library/react-native'
import { renderWithTheme } from '../test-render'
import { FileFinderView, searchResultLabel } from './file-finder-view'

test('searchResultLabel keeps a project-relative path and strips an absolute root', () => {
  expect(searchResultLabel('src/app.ts', '/workspace/super-one')).toEqual({
    label: 'src/app.ts',
    offset: 0,
  })
  expect(searchResultLabel('/workspace/super-one/src/app.ts', '/workspace/super-one')).toEqual({
    label: 'src/app.ts',
    offset: '/workspace/super-one/'.length,
  })
})

test('an empty query leaves the list blank rather than explaining search', async () => {
  await renderWithTheme(
    <FileFinderView
      query=""
      busy={false}
      onQuery={() => {}}
      finder={{
        kind: 'search',
        root: '/workspace/super-one',
        results: [],
        searched: false,
        onOpenDirectory: () => {},
        onOpenFile: () => {},
      }}
    />,
  )

  expect(screen.queryByText('Type to search this folder tree')).toBeNull()
  expect(screen.queryByText('Type to search this folder')).toBeNull()
  expect(screen.queryByText(/no matching files/i)).toBeNull()
})

test('a hit is one line of relative path, like an @ file mention', async () => {
  await renderWithTheme(
    <FileFinderView
      query="chat"
      busy={false}
      onQuery={() => {}}
      finder={{
        kind: 'search',
        root: '/workspace/super-one',
        results: [{
          path: 'apps/mobile/src/screens/chat-screen.tsx',
          isDirectory: false,
          matchIndices: [24, 25, 26, 27],
          score: 1,
        }],
        searched: true,
        onOpenDirectory: () => {},
        onOpenFile: () => {},
      }}
    />,
  )

  expect(screen.getByText('apps/mobile/src/screens/chat-screen.tsx')).toBeTruthy()
  expect(screen.queryByText('chat-screen.tsx')).toBeNull()
  expect(screen.queryByText('apps/mobile/src/screens')).toBeNull()
  for (const match of screen.getAllByText('chat')) expect(match).toHaveStyle({ fontWeight: '700' })
})

test('opening a relative hit joins it onto the search root', async () => {
  const onOpenFile = jest.fn()
  const onOpenDirectory = jest.fn()
  await renderWithTheme(
    <FileFinderView
      query="ui"
      busy={false}
      onQuery={() => {}}
      finder={{
        kind: 'search',
        root: '/workspace/super-one',
        results: [
          { path: 'src/ui', isDirectory: true, matchIndices: [], score: 1 },
          { path: 'src/app.ts', isDirectory: false, matchIndices: [], score: 0.9 },
        ],
        searched: true,
        onOpenDirectory,
        onOpenFile,
      }}
    />,
  )

  fireEvent.press(screen.getByText('src/ui'))
  fireEvent.press(screen.getByText('src/app.ts'))
  expect(onOpenDirectory).toHaveBeenCalledWith('/workspace/super-one/src/ui')
  expect(onOpenFile).toHaveBeenCalledWith('/workspace/super-one/src/app.ts')
})
