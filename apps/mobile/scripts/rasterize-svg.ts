import type { Page } from '@playwright/test'

/** Give a bare SVG a CSS box. Playwright screenshots that box, not the viewBox. */
export function sizedSvg(svg: string, width: number, height: number): string {
  return svg.replace(/<svg\b([^>]*)>/, (_match, attrs: string) => {
    const cleaned = attrs.replace(/\swidth="[^"]*"/g, '').replace(/\sheight="[^"]*"/g, '')
    return `<svg width="${width}" height="${height}" style="overflow:hidden"${cleaned}>`
  })
}

/**
 * Paint an SVG in the caller's Chromium page and return a transparent PNG of
 * its border box. Used for marks whose look depends on SVG filters:
 * `react-native-svg` does not reproduce `feGaussianBlur` the way the desktop
 * browser does, so those marks ship as rasters of this screenshot.
 */
export async function rasterizeSvg(page: Page, svg: string): Promise<Buffer> {
  await page.setContent(`<body style="margin:0;background:transparent">${svg}</body>`)
  const png = await page.locator('svg').screenshot({ omitBackground: true })
  if (png.length < 32) throw new Error('SVG raster is empty')
  return png
}
