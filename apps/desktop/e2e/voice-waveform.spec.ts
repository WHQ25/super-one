import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

test('silent voice waveform keeps a visible colored line across its width', async ({ page }) => {
  // jsdom cannot paint SVG: rasterize the production SVG in Chromium and inspect
  // pixels. A valid path alone cannot catch a gradient that paints nothing.
  // Render outside Playwright's JSX transform, which creates locator objects.
  const variants: string[] = JSON.parse(execFileSync('bun', ['-e', `
    import { createElement } from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import { VoiceAudioLevelStore } from '@superone/shared/voice-audio-levels';
    import { VoiceWaveform } from './src/renderer/src/components/chat/VoiceWaveform';
    process.stdout.write(JSON.stringify([false, true].map(compact =>
      renderToStaticMarkup(createElement(VoiceWaveform, { levels: new VoiceAudioLevelStore(), compact })))));
  `], { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8' }))
  for (const [index, markup] of variants.entries()) {
    const painted = await page.evaluate(async ({ markup, width }) => {
      const svg = new DOMParser().parseFromString(markup, 'image/svg+xml').documentElement
      svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
      svg.setAttribute('width', String(width))
      svg.setAttribute('height', '36')
      const image = new Image()
      image.src = `data:image/svg+xml,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = width; canvas.height = 36
      const context = canvas.getContext('2d')!
      context.drawImage(image, 0, 0)
      // Check the left, middle and right of the resting line; it must span
      // the viewport rather than survive as an isolated glow or endpoint.
      return [0.2, 0.5, 0.8].map(u => {
        const [r, g, b, alpha] = context.getImageData(Math.floor(width * u), 18, 1, 1).data
        return alpha > 100 && Math.max(r, g, b) - Math.min(r, g, b) > 20
      })
    }, { markup, width: index ? 24 : 300 })
    expect(painted).toEqual([true, true, true])
  }
})
