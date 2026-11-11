import { expect, test } from '@jest/globals'
import { screen } from '@testing-library/react-native'
import { renderWithTheme } from '../test-render'
import { HarnessIcon } from './harness-icon'

test.each([20, 80])('fits the Antigravity raster to the icon box at size %i', async (size) => {
  await renderWithTheme(<HarnessIcon provider="acp-antigravity" acpAgentId="antigravity" size={size} />)
  const mark = screen.getByTestId('harness-raster')
  expect(mark.props.source).toBeTruthy()
  // The mark sits in the size-2 scene box. A 384px PNG must not keep its bitmap size.
  expect(mark.props.style).toEqual({ position: 'absolute', top: 0, left: 0, width: size - 2, height: size - 2 })
  expect(screen.getByTestId('harness-icon-default')).toHaveStyle({ width: size, height: size })
})
