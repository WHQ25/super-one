import { describe, expect, it } from 'vitest'
import type { DeviceUiNode } from '@superone/shared/device-agent'
import {
  hasSemanticGap,
  hasUsableSemantics,
  largestSemanticGap,
  mergeRecognizedText,
  withoutRecognizedText,
  type NormalizedAccessibilityTree,
} from './tree'

/** An iPhone 17 Pro Max upright, standing in for any portrait phone. */
const PORTRAIT_SCREEN = { width: 440, height: 956 }

describe('largestSemanticGap', () => {
  it('reads a screen whose controls are spread across it as fully described', () => {
    const root: DeviceUiNode = {
      ref: '@e0',
      role: 'window',
      bounds: [0, 0, 1, 1],
      children: [
        { ref: '@e1', role: 'button', label: 'Sign in', bounds: [0.1, 0.05, 0.8, 0.2] },
        { ref: '@e2', role: 'text', label: 'Use your account', bounds: [0.1, 0.35, 0.8, 0.1] },
        { ref: '@e3', role: 'text', label: 'Forgot password?', bounds: [0.1, 0.55, 0.8, 0.1] },
        { ref: '@e4', role: 'button', label: 'Help', bounds: [0.1, 0.8, 0.8, 0.15] },
      ],
    }
    expect(largestSemanticGap(root)).toBeLessThan(0.35)
    expect(hasSemanticGap(root)).toBe(false)
  })

  it('sees the hole in a Safari window even though every toolbar control is named', () => {
    // The exact shape that made a loaded web page read as a blank screen: one named
    // node anywhere is enough for `hasUsableSemantics`, and Safari has several.
    const root: DeviceUiNode = {
      ref: '@e0',
      role: 'application',
      label: 'Safari',
      bounds: [0, 0, 1, 1],
      children: [
        { ref: '@e1', role: 'textField', label: 'Address', value: 'AI news', bounds: [0.1, 0, 0.8, 0.05] },
        { ref: '@e2', role: 'other', bounds: [0, 0.05, 1, 0.88] },
        { ref: '@e3', role: 'button', label: 'Back', bounds: [0.02, 0.93, 0.15, 0.06] },
        { ref: '@e4', role: 'button', label: 'Tabs', bounds: [0.8, 0.93, 0.15, 0.06] },
      ],
    }
    expect(hasUsableSemantics(root)).toBe(true)
    expect(largestSemanticGap(root)).toBeGreaterThan(0.8)
    expect(hasSemanticGap(root)).toBe(true)
  })

  it('finds the same hole when the device is on its side', () => {
    // Bounds arrive in FRAMEBUFFER space, which does not turn with the device: the
    // landscape Safari below has its chrome as full-height side strips. Banding along
    // Y there marks every row occupied, which made the whole hybrid path dead in
    // landscape while portrait kept working.
    const root: DeviceUiNode = {
      ref: '@e0',
      role: 'application',
      label: 'Safari',
      bounds: [0, 0, 1, 1],
      children: [
        { ref: '@e1', role: 'textField', label: 'Address', value: 'AI news', bounds: [0, 0.1, 0.05, 0.8] },
        { ref: '@e2', role: 'other', bounds: [0.05, 0, 0.88, 1] },
        { ref: '@e3', role: 'button', label: 'Back', bounds: [0.93, 0.02, 0.06, 0.15] },
        { ref: '@e4', role: 'button', label: 'Tabs', bounds: [0.93, 0.8, 0.06, 0.15] },
      ],
    }

    expect(largestSemanticGap(root, 'landscape-left')).toBeGreaterThan(0.8)
    expect(hasSemanticGap(root, 'landscape-left')).toBe(true)
    expect(hasSemanticGap(root, 'landscape-right')).toBe(true)
    // Read as an upright screen, the same tree looks fully described — which is
    // exactly what it used to be read as.
    expect(hasSemanticGap(root)).toBe(false)
  })

  it('does not let a labelled container paint the screen as described', () => {
    // A WebView with an accessibilityLabel over the whole page is the adversarial
    // case: counting its frame would report a fully described screen with nothing
    // readable in it.
    const root: DeviceUiNode = {
      ref: '@e0',
      role: 'window',
      bounds: [0, 0, 1, 1],
      children: [
        { ref: '@e1', role: 'webView', label: 'Web content', bounds: [0, 0.05, 1, 0.9] },
        { ref: '@e2', role: 'button', label: 'Back', bounds: [0.02, 0.95, 0.15, 0.04] },
      ],
    }
    expect(hasSemanticGap(root)).toBe(true)
  })
})

describe('withoutRecognizedText', () => {
  it('keeps the described half of a merged tree and drops the grafted lines', () => {
    // What makes a hybrid screen comparable between captures: OCR re-segments on its
    // own, so hashing the grafted half reported a change on a screen nobody touched
    // and `device_act` called a no-op action "worked".
    const root: DeviceUiNode = {
      ref: '@e0',
      role: 'application',
      bounds: [0, 0, 1, 1],
      children: [
        { ref: '@e1', role: 'button', label: 'Back', bounds: [0, 0.93, 0.15, 0.06] },
        { ref: '@e2', role: 'text', label: 'Sign In', source: 'ocr', bounds: [0.1, 0.4, 0.5, 0.05] },
      ],
    }

    const pruned = withoutRecognizedText(root)
    expect(pruned?.children?.map((child) => child.ref)).toEqual(['@e1'])
  })

  it('has nothing left to compare on a screen read entirely from pixels', () => {
    expect(withoutRecognizedText({
      ref: '@e0', role: 'window', source: 'ocr', bounds: [0, 0, 1, 1],
    })).toBeNull()
  })

  it('leaves a tree the app described in full untouched', () => {
    const root: DeviceUiNode = {
      ref: '@e0',
      role: 'window',
      bounds: [0, 0, 1, 1],
      children: [{ ref: '@e1', role: 'button', label: 'Back', bounds: [0, 0.9, 0.2, 0.1] }],
    }
    expect(withoutRecognizedText(root)).toEqual(root)
  })
})

describe('mergeRecognizedText', () => {
  const chrome = (): NormalizedAccessibilityTree => ({
    root: {
      ref: '@e0',
      role: 'application',
      label: 'Safari',
      bounds: [0, 0, 1, 1],
      children: [
        { ref: '@e1', role: 'textField', label: 'Address', value: 'AI news', bounds: [0.1, 0, 0.8, 0.05] },
        { ref: '@e2', role: 'button', label: 'Back', bounds: [0.02, 0.93, 0.15, 0.06] },
      ],
    },
    refs: new Map([['@e0', 1], ['@e1', 2], ['@e2', 3]]),
    screenPoints: PORTRAIT_SCREEN,
  })

  const recognized = (
    lines: Array<{ label: string; bounds: [number, number, number, number] }>,
  ): NormalizedAccessibilityTree => ({
    root: {
      ref: '@e0',
      role: 'screen',
      bounds: [0, 0, 1, 1],
      source: 'ocr',
      children: lines.map((line, index) => ({
        ref: `@e${index + 1}`,
        role: 'text',
        label: line.label,
        bounds: line.bounds,
        source: 'ocr' as const,
      })),
    },
    refs: new Map(),
    screenPoints: PORTRAIT_SCREEN,
    source: 'ocr',
  })

  it('numbers grafted text past the app\'s own refs and leaves them unaddressable', () => {
    const { tree, added } = mergeRecognizedText(
      chrome(),
      recognized([{ label: 'Baidu results', bounds: [0.05, 0.4, 0.9, 0.03] }]),
    )

    expect(added).toBe(1)
    const grafted = tree.root.children?.[2]
    expect(grafted?.ref).toBe('@e3')
    expect(grafted?.source).toBe('ocr')
    // Absent from `refs` on purpose: it addresses no helper element, and a uid
    // invented for it would press whatever happens to occupy that slot.
    expect(tree.refs.has('@e3')).toBe(false)
  })

  it('drops a line that only repeats a control the app already named', () => {
    const { tree, added } = mergeRecognizedText(
      chrome(),
      recognized([{ label: 'AI news', bounds: [0.15, 0.01, 0.4, 0.03] }]),
    )

    expect(added).toBe(0)
    expect(tree.root.children).toHaveLength(2)
  })

  it('leaves the tree untouched when nothing was recognized', () => {
    const original = chrome()
    const { tree } = mergeRecognizedText(original, recognized([]))
    expect(tree).toBe(original)
  })
})
