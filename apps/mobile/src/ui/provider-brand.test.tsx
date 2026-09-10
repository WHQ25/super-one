import { expect, test } from '@jest/globals'
import { screen } from '@testing-library/react-native'
import { renderWithTheme } from '../test-render'
import { ProviderBrand } from './provider-brand'

test('renders the OpenAI lockup by name', async () => {
  await renderWithTheme(<ProviderBrand brandKey="openai" name="Codex (Official)" size={14} />)
  expect(screen.getByLabelText('Codex (Official)')).toBeTruthy()
})
