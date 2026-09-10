import { expect, test } from 'vitest'
import data from './provider-brands.generated.json'
import { tintSvgCurrentColor } from './tint-svg-current-color'

test('bakes the theme colour into currentColor so OpenAI is visible on first paint', () => {
  const svg = data.brands.openai.icon.svg
  expect(svg).toContain('currentColor')
  const tinted = tintSvgCurrentColor(svg, '#fafafa')
  expect(tinted).toContain('#fafafa')
  expect(tinted).not.toMatch(/currentColor/i)
})
