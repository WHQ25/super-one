import type { ComponentProps } from 'react'
import { View } from 'react-native'
import { MobileThemeProvider } from '../theme/context'
import { FileFinderView } from './file-finder-view'

const noop = () => {}

const searchFinder = {
  kind: 'search' as const,
  root: '/workspace/super-one',
  results: [
    { path: 'apps/mobile/src/screens/chat-screen.tsx', isDirectory: false, matchIndices: [24, 25, 26, 27], score: 1 },
    { path: 'apps/mobile/src/screens/chat-composer.tsx', isDirectory: false, matchIndices: [24, 25, 26, 27], score: 0.9 },
    { path: 'packages/chat-view/src/index.ts', isDirectory: false, matchIndices: [9, 10, 11, 12], score: 0.7 },
    { path: 'apps/mobile/src/screens', isDirectory: true, matchIndices: [], score: 0.4 },
  ],
  searched: true,
  onOpenDirectory: noop,
  onOpenFile: noop,
}

const search: ComponentProps<typeof FileFinderView> = {
  query: 'chat',
  busy: false,
  onQuery: noop,
  finder: searchFinder,
}

function Preview(props: ComponentProps<typeof FileFinderView>) {
  return (
    <MobileThemeProvider>
      <View style={{ width: 390, height: 480 }}>
        <FileFinderView {...props} />
      </View>
    </MobileThemeProvider>
  )
}

export default {
  title: 'Mobile/FileFinder',
  component: FileFinderView,
  render: Preview,
  args: search,
}

export const Hits = {
  name: 'Search hits · mention-style path',
}

export const EmptyQuery = {
  args: { query: '', finder: { ...searchFinder, results: [], searched: false } },
  name: 'Empty query · no prompt copy',
}

export const NoMatches = {
  args: { query: 'zzz', finder: { ...searchFinder, results: [], searched: true } },
  name: 'No matching files',
}

export const Searching = {
  args: { query: 'ch', busy: true, finder: { ...searchFinder, results: [], searched: false } },
  name: 'Searching',
}

export const GoToFolder = {
  args: {
    query: '/Users/dev/Dev',
    busy: false,
    finder: {
      kind: 'goto',
      suggestions: [
        { name: 'Developer', isDirectory: true },
        { name: 'Devtools', isDirectory: true },
      ],
      onComplete: noop,
      onSubmit: noop,
    },
  },
  name: 'Go to folder · completions',
}
