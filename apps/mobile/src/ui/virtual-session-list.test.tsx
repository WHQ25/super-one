import { expect, jest, test } from '@jest/globals'
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native'
import { Text } from 'react-native'
import { renderWithTheme } from '../test-render'
import { SESSION_LIST_MAX_HEIGHT, sessionListFades, VirtualSessionList } from './virtual-session-list'

const row = (index: number) => <Text>{`Row ${index}`}</Text>

test('mounts the visible window, not every row', async () => {
  await renderWithTheme(
    <VirtualSessionList
      testID="active-session-list"
      count={40}
      getKey={(index) => index}
      renderItem={row}
    />,
  )
  expect(screen.getByText('Row 0')).toBeTruthy()
  expect(screen.queryByText('Row 39')).toBeNull()
  expect(screen.getByTestId('active-session-list').props.style).toEqual({
    height: SESSION_LIST_MAX_HEIGHT, flexGrow: 0, flexShrink: 0,
  })
  // Rows keep their own offset. A shared translateY of 0 would stack them on the first line.
  const tops = absoluteTops()
  expect(tops).toContain(0)
  expect(tops).toContain(40)
  expect(screen.getByTestId('session-list-fade-bottom')).toBeTruthy()
  expect(screen.queryByTestId('session-list-fade-top')).toBeNull()
})

test('asks once when the loaded rows do not fill the cap and another page exists', async () => {
  const onLoadMore = jest.fn<() => void>()
  await renderWithTheme(
    <VirtualSessionList count={2} hasMore getKey={(index) => index} renderItem={row} onLoadMore={onLoadMore} />,
  )
  await waitFor(() => expect(onLoadMore).toHaveBeenCalledTimes(1))
})

test('does not ask again when the list is complete', async () => {
  const onLoadMore = jest.fn<() => void>()
  await renderWithTheme(
    <VirtualSessionList count={2} getKey={(index) => index} renderItem={row} onLoadMore={onLoadMore} />,
  )
  expect(onLoadMore).not.toHaveBeenCalled()
  expect(screen.queryByTestId('session-list-fade-top')).toBeNull()
  expect(screen.queryByTestId('session-list-fade-bottom')).toBeNull()
})

test('asks again when a hidden page arrives and the visible count stays put', async () => {
  const onLoadMore = jest.fn<() => void>()
  const list = (loadToken: number) => (
    <VirtualSessionList count={1} loadToken={loadToken} hasMore getKey={(index) => index} renderItem={row} onLoadMore={onLoadMore} />
  )
  const view = await renderWithTheme(list(30))
  await waitFor(() => expect(onLoadMore).toHaveBeenCalledTimes(1))
  await view.rerender(list(60))
  await waitFor(() => expect(onLoadMore).toHaveBeenCalledTimes(2))
  await view.rerender(list(60))
  await act(async () => {})
  expect(onLoadMore).toHaveBeenCalledTimes(2)
})

test('fades an edge only while it still hides rows', () => {
  expect(sessionListFades(0, 80, 80)).toEqual({ top: false, bottom: false })
  expect(sessionListFades(0, 256, 1600)).toEqual({ top: false, bottom: true })
  expect(sessionListFades(400, 256, 1600)).toEqual({ top: true, bottom: true })
  expect(sessionListFades(1344, 256, 1600)).toEqual({ top: true, bottom: false })
})

test('loads the next page once when scrolled near the bottom', async () => {
  const onLoadMore = jest.fn<() => void>()
  await renderWithTheme(
    <VirtualSessionList
      testID="active-session-list"
      count={40}
      hasMore
      getKey={(index) => index}
      renderItem={row}
      onLoadMore={onLoadMore}
    />,
  )
  expect(onLoadMore).not.toHaveBeenCalled()
  const list = screen.getByTestId('active-session-list')
  const nearBottom = { nativeEvent: { contentOffset: { y: 1200 }, contentSize: { height: 1600, width: 300 }, layoutMeasurement: { height: 256, width: 300 } } }
  fireEvent.scroll(list, nearBottom)
  fireEvent.scroll(list, { nativeEvent: { ...nearBottom.nativeEvent, contentOffset: { y: 1300 } } })
  expect(onLoadMore).toHaveBeenCalledTimes(1)
})

function absoluteTops(): number[] {
  const found: number[] = []
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return
    const current = node as { props?: { style?: unknown }; children?: unknown }
    const styles = Array.isArray(current.props?.style) ? current.props.style : [current.props?.style]
    for (const style of styles) {
      if (!style || typeof style !== 'object' || !('top' in style)) continue
      const box = style as { position?: string; top?: unknown }
      if (box.position === 'absolute' && typeof box.top === 'number') found.push(box.top)
    }
    const children = Array.isArray(current.children) ? current.children : []
    children.forEach(walk)
  }
  walk(screen.toJSON())
  return found
}
