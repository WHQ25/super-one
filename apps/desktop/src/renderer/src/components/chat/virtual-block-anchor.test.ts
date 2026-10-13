/** @vitest-environment jsdom */
import { Virtualizer } from '@tanstack/react-virtual'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createVirtualBlockAnchor } from './virtual-block-anchor'

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks() })

function fixture(initial = [20, 20], inset = 200) {
  const viewport = document.createElement('div')
  const row = document.createElement('div')
  row.dataset.virtualRow = ''
  row.dataset.index = '1'
  const blocks = initial.map(() => document.createElement('div'))
  const reading = document.createElement('p')
  row.append(...blocks, reading)
  viewport.append(row)
  document.body.append(viewport)
  const heights = [...initial]
  const delta = () => heights.reduce((sum, height, index) => sum + height - initial[index], 0)
  const rowTop = () => 200 - viewport.scrollTop + 100
  const rect = (top: number, height: number) => new DOMRect(0, top, 640, height)
  vi.spyOn(viewport, 'getBoundingClientRect').mockImplementation(() => rect(100, 400))
  vi.spyOn(row, 'getBoundingClientRect').mockImplementation(() => rect(rowTop(), 2001 + delta()))
  blocks.forEach((block, index) => {
    vi.spyOn(block, 'getBoundingClientRect').mockImplementation(() => rect(rowTop() + inset + heights.slice(0, index).reduce((a, b) => a + b, 0), heights[index]))
  })
  vi.spyOn(reading, 'getBoundingClientRect').mockImplementation(() => rect(rowTop() + 440 + delta(), 24))
  Object.defineProperties(viewport, { clientHeight: { value: 400 }, scrollHeight: { value: 4000 } })
  const virtualizer = new Virtualizer<HTMLDivElement, Element>({
    count: 3,
    getScrollElement: () => viewport,
    estimateSize: index => index === 1 ? 2000 : 200,
    initialOffset: 600,
    observeElementRect: (_instance, callback) => { callback({ width: 640, height: 400 }); return () => {} },
    observeElementOffset: (_instance, callback) => { callback(600, false); return () => {} },
    scrollToFn: (offset, { adjustments }) => { viewport.scrollTop = offset + (adjustments ?? 0) },
    measureElement: node => node.getBoundingClientRect().height,
  })
  virtualizer._willUpdate()
  virtualizer.getVirtualItems()
  virtualizer.resizeItem(1, 2001)
  viewport.scrollTop = 600
  virtualizer.scrollOffset = 600
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, instance) => item.end < (instance.scrollOffset ?? 0)
  const anchor = createVirtualBlockAnchor({ current: viewport }, { current: virtualizer })
  const reveal = (next: number[]) => {
    blocks.forEach(block => anchor.prepare(block))
    heights.splice(0, heights.length, ...next)
    blocks.forEach((block, index) => anchor.preserve(block, initial[index]))
  }
  return { viewport, row, blocks, reading, heights, virtualizer, anchor, reveal }
}

describe('virtual block reading anchor', () => {
  it('batches large sibling reveals even when the first moves the second below the fold', async () => {
    const { viewport, reading, reveal } = fixture()
    const before = reading.getBoundingClientRect().top
    reveal([400, 400])
    await Promise.resolve()
    expect(viewport.scrollTop).toBe(1360)
    expect(reading.getBoundingClientRect().top).toBe(before)
  })

  it('preserves the reading anchor when above-fold placeholders shrink', async () => {
    const { viewport, reading, reveal } = fixture([200, 100], 0)
    const before = reading.getBoundingClientRect().top
    reveal([20, 20])
    await Promise.resolve()
    expect(viewport.scrollTop).toBe(340)
    expect(reading.getBoundingClientRect().top).toBe(before)
  })

  it('counts nested block growth once', async () => {
    const { viewport, blocks, heights, anchor } = fixture()
    const child = document.createElement('div')
    blocks[0].append(child)
    let childHeight = 10
    vi.spyOn(child, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, blocks[0].getBoundingClientRect().top, 640, childHeight))
    anchor.prepare(child)
    // The parent also has a pending reveal; its delta includes the child.
    heights[0] = 400
    childHeight = 200
    anchor.preserve(child, 10)
    anchor.preserve(blocks[0], 20)
    await Promise.resolve()
    expect(viewport.scrollTop).toBe(980)
  })

  it('leaves fully above-fold row compensation to the virtualizer', async () => {
    const { viewport, row, virtualizer, reveal } = fixture()
    viewport.scrollTop = 3000
    virtualizer.scrollOffset = 3000
    reveal([400, 400])
    await Promise.resolve()
    expect(viewport.scrollTop).toBe(3000)
    virtualizer.measureElement(row)
    expect(viewport.scrollTop).toBe(3760)
  })

  it('does not move history for content that was below the fold', async () => {
    const { viewport, reveal } = fixture([20, 20], 500)
    reveal([400, 400])
    await Promise.resolve()
    expect(viewport.scrollTop).toBe(600)
  })

  it('leaves bottom following to the virtualizer and chat scroll host', async () => {
    const { viewport, virtualizer, reveal } = fixture()
    viewport.scrollTop = 3600
    virtualizer.scrollOffset = 3600
    reveal([400, 400])
    await Promise.resolve()
    expect(viewport.scrollTop).toBe(3600)
  })

  it('cancels queued corrections when the transcript is disposed', async () => {
    const { viewport, anchor, reveal } = fixture()
    reveal([400, 400])
    anchor.cancel()
    await Promise.resolve()
    expect(viewport.scrollTop).toBe(600)
  })
})
