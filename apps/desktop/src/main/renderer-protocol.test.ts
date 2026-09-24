import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { resolveRendererAsset } from './renderer-protocol'

const root = '/app/out/renderer'

describe('resolveRendererAsset', () => {
  it('maps renderer URLs to files under the root', () => {
    expect(resolveRendererAsset(root, 'superone-renderer://app/index.html?mode=miniwindow')).toBe(join(root, 'index.html'))
    expect(resolveRendererAsset(root, 'superone-renderer://app/assets/pdf.worker-x.mjs')).toBe(join(root, 'assets/pdf.worker-x.mjs'))
  })

  it('decodes escaped path segments', () => {
    expect(resolveRendererAsset(root, 'superone-renderer://app/assets/a%20b.woff2')).toBe(join(root, 'assets/a b.woff2'))
  })

  it('refuses paths that escape the root once decoded', () => {
    expect(resolveRendererAsset(root, 'superone-renderer://app/%2e%2e%2fmain/index.js')).toBeNull()
    expect(resolveRendererAsset(root, 'superone-renderer://app/..%2f..%2fsecret')).toBeNull()
  })

  it('refuses malformed escapes instead of throwing', () => {
    expect(resolveRendererAsset(root, 'superone-renderer://app/assets/%E0%A4%A.js')).toBeNull()
  })

  it('refuses other hosts and schemes', () => {
    expect(resolveRendererAsset(root, 'superone-renderer://evil/index.html')).toBeNull()
    expect(resolveRendererAsset(root, 'file:///app/out/renderer/index.html')).toBeNull()
    expect(resolveRendererAsset(root, 'not a url')).toBeNull()
  })
})
