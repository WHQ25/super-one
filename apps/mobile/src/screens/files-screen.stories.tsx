import type { ComponentProps } from 'react'
import { View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { MobileThemeProvider } from '../theme/context'
import { buildGitToneMap } from '../navigation/use-project-git-status'
import { FilesScreen } from './files-screen'

const noop = () => {}

const project = { kind: 'project' as const, root: '/workspace/super-one', name: 'super-one' }

const gitTones = buildGitToneMap([
  { path: 'apps/mobile/src/chat-screen.tsx', index: null, worktree: 'M' },
  { path: 'apps/mobile/src/files-screen.tsx', index: 'A', worktree: null },
  { path: 'apps/mobile/src/runtime.ts', index: 'M', worktree: 'M' },
  { path: 'apps/mobile/src/screens/gone.ts', index: 'D', worktree: null },
])

const base: ComponentProps<typeof FilesScreen> = {
  mode: project,
  path: '/workspace/super-one/apps/mobile/src',
  items: [
    { name: 'screens', isDirectory: true },
    { name: 'chat-screen.tsx', isDirectory: false },
    { name: 'files-screen.tsx', isDirectory: false },
    { name: 'runtime.ts', isDirectory: false },
  ],
  gitTones,
  onRefresh: noop,
  onOpenDirectory: noop,
  onOpenFile: noop,
}

function Preview(props: ComponentProps<typeof FilesScreen>) {
  return (
    <MobileThemeProvider>
      <SafeAreaProvider initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}>
        <View style={{ width: 390, height: 560 }}>
          <FilesScreen {...props} />
        </View>
      </SafeAreaProvider>
    </MobileThemeProvider>
  )
}

export default {
  title: 'Mobile/FilesScreen',
  component: FilesScreen,
  render: Preview,
  args: base,
}

export const Listing = {
  name: 'Folder listing · git tones',
}

export const Empty = {
  args: { items: [], path: '/workspace/super-one/empty' },
  name: 'Empty folder',
}

export const Error = {
  args: {
    items: [],
    error: 'Could not read this folder. Check the desktop connection.',
  },
  name: 'Folder error · retry',
}

export const Computer = {
  args: {
    mode: { kind: 'computer', name: 'Studio Mac' },
    path: '/Users/dev/Developer',
    items: [
      { name: 'Projects', isDirectory: true },
      { name: 'notes.md', isDirectory: false },
    ],
    gitTones: undefined,
  },
  name: 'Computer · unfenced listing',
}
