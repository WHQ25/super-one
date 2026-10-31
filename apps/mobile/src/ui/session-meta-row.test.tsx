import { expect, test } from '@jest/globals'
import { screen } from '@testing-library/react-native'
import { renderWithTheme } from '../test-render'
import { SessionMetaRow } from './session-meta-row'

const branch = 'refactor/unified-session-state-and-remote-control-architecture'

test('a removed worktree leaves the project name and hides the missing chip', async () => {
  await renderWithTheme(<SessionMetaRow deviceStatus="connectedLan" subtitle="super-one"
    git={{ kind: 'worktreeMissing' }} />)

  expect(screen.getByText('super-one')).toBeTruthy()
  expect(screen.queryByText('Worktree Missing')).toBeNull()
  expect(screen.queryByLabelText('Worktree missing — running in the project folder')).toBeNull()
})

test.each(['branch', 'worktreeBranch'] as const)('reserves the project name before truncating a long %s', async kind => {
  await renderWithTheme(<SessionMetaRow deviceStatus="connectedLan" subtitle="super-one"
    git={kind === 'branch' ? { kind, branch, dirtyFiles: 2 } : { kind, branch }} />)

  expect(screen.getByText('super-one')).toHaveStyle({ flexShrink: 0 })
  expect(screen.getByText(branch)).toHaveStyle({ flexShrink: 1 })
  expect(screen.getByText(branch).props.numberOfLines).toBe(1)
})
