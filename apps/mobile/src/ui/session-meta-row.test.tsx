import { expect, test } from '@jest/globals'
import { screen } from '@testing-library/react-native'
import { renderWithTheme } from '../test-render'
import { SessionMetaRow } from './session-meta-row'

const branch = 'refactor/unified-session-state-and-remote-control-architecture'

test.each(['branch', 'worktreeBranch'] as const)('reserves the project name before truncating a long %s', async kind => {
  await renderWithTheme(<SessionMetaRow deviceStatus="connectedLan" subtitle="super-one"
    git={kind === 'branch' ? { kind, branch, dirtyFiles: 2 } : { kind, branch }} />)

  expect(screen.getByText('super-one')).toHaveStyle({ flexShrink: 0 })
  expect(screen.getByText(branch)).toHaveStyle({ flexShrink: 1 })
  expect(screen.getByText(branch).props.numberOfLines).toBe(1)
})
