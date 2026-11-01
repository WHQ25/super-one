import type { ComponentProps } from 'react'
import { expect, test } from '@jest/globals'
import { Text } from 'react-native'
import { screen } from '@testing-library/react-native'
import type { SessionActivity } from '@superone/shared/session-activity'
import { renderWithTheme } from '../test-render'
import { SessionActivityContext } from '../navigation/use-session-activity'
import { SwipeSessionRow } from './swipe-session-row'

const noop = () => {}
const row = (props: Partial<ComponentProps<typeof SwipeSessionRow>> = {}) => (
  <SwipeSessionRow title="Fix the drawer" sessionId="s1" onPress={noop} onPin={noop} onSettle={noop} onDelete={noop} {...props}>
    {() => <Text>Fix the drawer</Text>}
  </SwipeSessionRow>
)

const actionNames = () => {
  const button = screen.getByRole('button', { name: 'Fix the drawer' })
  return (button.props.accessibilityActions as Array<{ name: string }>).map((action) => action.name)
}

/** Depth-first testIDs follow the strip's paint order. */
function paintedActions(): string[] {
  const found: string[] = []
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return
    const current = node as { props?: { testID?: string }; children?: unknown }
    if (typeof current.props?.testID === 'string' && current.props.testID.startsWith('swipe-action-')) found.push(current.props.testID)
    const children = Array.isArray(current.children) ? current.children : []
    children.forEach(walk)
  }
  walk(screen.toJSON())
  return found
}

test('paints Settle, then Pin, then Delete from left to right', async () => {
  await renderWithTheme(row())
  expect(actionNames()).toEqual(['activate', 'settle', 'pin', 'delete'])
  expect(paintedActions()).toEqual(['swipe-action-settle', 'swipe-action-pin', 'swipe-action-delete'])
})

test('offers Unsettle and Delete on a settled row, and no pin', async () => {
  await renderWithTheme(row({ settled: true }))
  expect(actionNames()).toEqual(['activate', 'settle', 'delete'])
  expect(paintedActions()).toEqual(['swipe-action-settle', 'swipe-action-delete'])
  expect(screen.getByRole('button', { name: 'Fix the drawer' }).props.accessibilityActions[1].label).toBe('Unsettle')
})

test('hides Settle while the session is still working', async () => {
  const running: SessionActivity = {
    sessionId: 's1', projectPath: '/repo', status: 'streaming', provider: 'codex',
    pendingCount: 0, pendingReason: { en: null, zh: null },
  }
  await renderWithTheme(
    <SessionActivityContext.Provider value={{ s1: running }}>
      {row()}
    </SessionActivityContext.Provider>,
  )
  expect(actionNames()).toEqual(['activate', 'pin', 'delete'])
  expect(paintedActions()).toEqual(['swipe-action-pin', 'swipe-action-delete'])
})
