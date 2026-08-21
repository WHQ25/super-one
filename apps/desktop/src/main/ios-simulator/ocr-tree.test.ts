import { describe, expect, it } from 'vitest'
import { ocrToTree, type IosSimulatorOcrLine } from './ocr-tree'

function line(overrides: Partial<IosSimulatorOcrLine> = {}): IosSimulatorOcrLine {
  return { text: 'Sign in', confidence: 0.9, x: 0.1, y: 0.05, width: 0.3, height: 0.02, ...overrides }
}

describe('OCR results as a UI tree', () => {
  it('hangs one node per line under a full-screen root', () => {
    const tree = ocrToTree([line({ text: 'Sign in' }), line({ text: 'Register', y: 0.1 })], 'portrait')

    expect(tree.root.ref).toBe('@e0')
    expect(tree.root.bounds).toEqual([0, 0, 1, 1])
    expect(tree.root.children?.map((node) => node.label)).toEqual(['Sign in', 'Register'])
    expect(tree.root.children?.map((node) => node.ref)).toEqual(['@e1', '@e2'])
  })

  it('marks every node as OCR-sourced', () => {
    const tree = ocrToTree([line()], 'portrait')

    expect(tree.source).toBe('ocr')
    expect(tree.root.source).toBe('ocr')
    expect(tree.root.children?.[0]?.source).toBe('ocr')
  })

  it('keeps role honest rather than guessing that big text is a button', () => {
    const tree = ocrToTree([line({ height: 0.2 })], 'portrait')

    expect(tree.root.children?.[0]?.role).toBe('text')
  })

  it('hands out no uid refs, because nothing here can be pressed through accessibility', () => {
    const tree = ocrToTree([line()], 'portrait')

    expect(tree.refs.size).toBe(0)
  })

  it('passes portrait boxes through untouched', () => {
    const tree = ocrToTree([line({ x: 0.1, y: 0.05, width: 0.3, height: 0.02 })], 'portrait')

    expect(tree.root.children?.[0]?.bounds).toEqual([0.1, 0.05, 0.3, 0.02])
  })

  /**
   * The framebuffer stays portrait while the guest draws rotated into it, so a box
   * read off the upright image has to be turned back before anything can be tapped
   * at it. Verified against the device: in landscape-right the upright top edge is
   * the framebuffer's LEFT edge, so a banner across the top becomes a strip down
   * the side.
   */
  it('turns upright boxes back into framebuffer space when the device is landscape', () => {
    const tree = ocrToTree([line({ x: 0.1, y: 0.05, width: 0.3, height: 0.02 })], 'landscape-right')

    expect(tree.root.children?.[0]?.bounds).toEqual([0.05, 0.6, 0.02, 0.3])
  })

  it('drops a line whose box is degenerate rather than emitting an untappable node', () => {
    const tree = ocrToTree([line({ width: 0 }), line({ text: 'Keep me' })], 'portrait')

    expect(tree.root.children?.map((node) => node.label)).toEqual(['Keep me'])
  })

  it('reports an empty screen as a root with no children, not as a failure', () => {
    const tree = ocrToTree([], 'portrait')

    expect(tree.root.children).toBeUndefined()
  })

  it('caps the node count so a text-dense screen cannot blow up the reply', () => {
    const lines = Array.from({ length: 40 }, (_, index) => line({ text: `line ${index}` }))

    const tree = ocrToTree(lines, 'portrait', { maxNodes: 10 })

    expect(tree.root.children).toHaveLength(9)
    expect(tree.root.truncatedChildren).toBe(31)
  })
})
