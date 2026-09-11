import { expect, test } from '@jest/globals'
import { screen } from '@testing-library/react-native'
import { renderWithTheme } from '../test-render'
import { FilesScreen } from './files-screen'

const mode = { kind: 'project' as const, root: '/workspace/super-one', name: 'super-one' }

test('lists the folder without upload or new-folder buttons on the page', async () => {
  await renderWithTheme(
    <FilesScreen
      mode={mode}
      path="/workspace/super-one/apps/mobile/src"
      items={[
        { name: 'screens', isDirectory: true },
        { name: 'files-screen.tsx', isDirectory: false },
      ]}
      onRefresh={() => {}}
      onOpenDirectory={() => {}}
      onOpenFile={() => {}}
    />,
  )

  expect(screen.getByText('files-screen.tsx')).toBeTruthy()
  expect(screen.getByText('screens')).toBeTruthy()
  expect(screen.queryByText('Upload File')).toBeNull()
  expect(screen.queryByText('New Folder')).toBeNull()
})
