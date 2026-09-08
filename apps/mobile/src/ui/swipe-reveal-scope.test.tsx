import { expect, test } from '@jest/globals'
import { screen } from '@testing-library/react-native'
import { useEffect } from 'react'
import { Text } from 'react-native'
import { renderWithTheme } from '../test-render'
import {
  SwipeRevealProvider,
  useReportSwipeReveal,
  useSwipeRevealScope,
  type SwipeRevealScope,
} from './swipe-reveal-scope'

/**
 * Stands in for `SwipeRow`, which reports the same thing out of its gesture
 * handlers. Driven by a prop rather than `fireEvent.press` on purpose: a press
 * opens a React 19 act scope that has not closed by the time `rerender` runs, so
 * the rerender never commits and the unmount under test never happens.
 */
function Row({ label, revealed }: { label: string; revealed?: boolean }) {
  const report = useReportSwipeReveal()
  useEffect(() => { report(!!revealed) }, [report, revealed])
  return <Text>{label}</Text>
}

type ScopeOut = { current: SwipeRevealScope | null }

function Harness({ out, rows }: { out: ScopeOut; rows: Array<{ label: string; revealed?: boolean }> }) {
  const scope = useSwipeRevealScope()
  out.current = scope
  return <SwipeRevealProvider scope={scope}>
    {rows.map((row) => <Row key={row.label} {...row} />)}
  </SwipeRevealProvider>
}

test('reports nothing while every row is closed', async () => {
  const out: ScopeOut = { current: null }
  await renderWithTheme(<Harness out={out} rows={[{ label: 'a' }, { label: 'b' }]} />)
  expect(out.current?.anyRevealed()).toBe(false)
})

test('a row with its actions showing holds the scope open', async () => {
  const out: ScopeOut = { current: null }
  await renderWithTheme(<Harness out={out} rows={[{ label: 'a', revealed: true }, { label: 'b' }]} />)
  expect(out.current?.anyRevealed()).toBe(true)
})

test('closing the row hands the gesture back', async () => {
  const out: ScopeOut = { current: null }
  const { rerender } = await renderWithTheme(
    <Harness out={out} rows={[{ label: 'a', revealed: true }]} />,
  )
  await rerender(<Harness out={out} rows={[{ label: 'a' }]} />)
  expect(out.current?.anyRevealed()).toBe(false)
})

test('a row unmounted while open releases the scope', async () => {
  // Otherwise the container's own gesture — the drawer's swipe to close — stays
  // disabled for the rest of the session with nothing on screen to explain it.
  const out: ScopeOut = { current: null }
  const { rerender } = await renderWithTheme(
    <Harness out={out} rows={[{ label: 'a', revealed: true }, { label: 'b' }]} />,
  )
  await rerender(<Harness out={out} rows={[{ label: 'b' }]} />)
  expect(out.current?.anyRevealed()).toBe(false)
})

test('a row outside any scope reports into nothing rather than throwing', async () => {
  await renderWithTheme(<Row label="loose" revealed />)
  expect(screen.getByText('loose')).toBeTruthy()
})
