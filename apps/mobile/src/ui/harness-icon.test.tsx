import { expect, test } from '@jest/globals'
import { screen } from '@testing-library/react-native'
import { renderWithTheme } from '../test-render'
import { HarnessIcon } from './harness-icon'

test('draws the Antigravity session mark from its raster', async () => {
  await renderWithTheme(<HarnessIcon provider="acp" acpAgentId="antigravity" size={20} />)
  const mark = screen.getByTestId('harness-raster')
  expect(mark.props.source).toBeTruthy()
  expect(mark.props.style).toEqual(expect.objectContaining({ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }))
  expect(screen.getByTestId('harness-icon-default')).toBeTruthy()
})
