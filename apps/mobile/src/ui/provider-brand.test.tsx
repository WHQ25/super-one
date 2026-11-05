import { expect, test } from '@jest/globals'
import { screen } from '@testing-library/react-native'
import { renderWithTheme } from '../test-render'
import { ProviderBrand } from './provider-brand'

test('renders the OpenAI lockup by name', async () => {
  await renderWithTheme(<ProviderBrand brandKey="openai" name="Codex (Official)" size={14} />)
  expect(screen.getByLabelText('Codex (Official)')).toBeTruthy()
  expect(screen.getByTestId('provider-brand-icon').props.xml).toContain('<svg')
})

test('draws the Antigravity mark from its raster', async () => {
  await renderWithTheme(<ProviderBrand brandKey="antigravity" name="Antigravity" size={14} />)
  expect(screen.getByLabelText('Antigravity')).toBeTruthy()
  const icon = screen.getByTestId('provider-brand-icon')
  expect(icon.props.source).toBeTruthy()
  expect(icon.props.xml).toBeUndefined()
})
