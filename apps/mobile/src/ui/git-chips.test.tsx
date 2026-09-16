import { expect, test } from '@jest/globals'
import { act, fireEvent, screen } from '@testing-library/react-native'
import { renderWithTheme } from '../test-render'
import { GitChips } from './git-chips'

const LONG = 'feat/optimize-skill-and-prompt-for-agent-collaboration-handoff'
const noop = () => {}

test('a pending plan reads as one sentence to screen readers but keeps its name as a separate unit', async () => {
  // The prefix and the value group are siblings so the value group can drop
  // to its own line as a whole when the name is long.
  await renderWithTheme(<GitChips selection={{ kind: 'create', baseBranch: LONG, mode: 'detach', branchName: '', carryLocalChanges: false }}
    onWorktree={noop} onBranch={noop} />)

  expect(screen.getByLabelText(`Create Worktree From ${LONG}`)).toBeTruthy()
  expect(screen.getByText('Create Worktree From')).toBeTruthy()
  expect(screen.getByText(LONG)).toHaveStyle({ flexShrink: 1 })
})

test('the divider blanks once the branch chip has wrapped under the local chip', async () => {
  await renderWithTheme(<GitChips selection={{ kind: 'local' }} branch={LONG} onWorktree={noop} onBranch={noop} />)
  const local = () => screen.getByLabelText('Local')
  const branch = () => screen.getByLabelText(`Branch: ${LONG}`).parent!
  const divider = () => branch().children[0] as ReturnType<typeof branch>
  const layout = (target: () => ReturnType<typeof branch>, y: number) =>
    act(async () => { fireEvent(target(), 'layout', { nativeEvent: { layout: { x: 0, y, width: 200, height: 36 } } }) })

  await layout(local, 0)
  await layout(branch, 0)
  expect(divider()).toHaveStyle({ opacity: 1 })

  await layout(branch, 38)
  expect(divider()).toHaveStyle({ opacity: 0 })
})
