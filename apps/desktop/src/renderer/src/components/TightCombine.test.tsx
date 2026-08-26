/** @vitest-environment jsdom */

import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyTightSvgBox,
  TIGHT_COMBINE_SPACE_MULTIPLE,
  TIGHT_COMBINE_TEXT_MULTIPLE,
  TightCombine,
} from './TightCombine'
import { ProviderLabel } from './ProviderLabel'

function mockGetBBox(box: { x: number; y: number; width: number; height: number }) {
  const proto = SVGElement.prototype as SVGElement & { getBBox?: () => DOMRect }
  const prev = proto.getBBox
  proto.getBBox = () =>
    ({
      ...box,
      bottom: box.y + box.height,
      right: box.x + box.width,
      top: box.y,
      left: box.x,
      toJSON: () => box,
    }) as DOMRect
  return () => {
    if (prev) proto.getBBox = prev
    else delete proto.getBBox
  }
}

function FakeMark({ size = 24 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} data-testid="mark">
      <path d="M2 2h20v20H2z" />
    </svg>
  )
}

function FakeText({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 80 24" height={size} data-testid="text">
      <path d="M4 4h72v16H4z" />
    </svg>
  )
}

describe('applyTightSvgBox', () => {
  it('contains a landscape mark so the long side equals size', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    const restore = mockGetBBox({ x: 2, y: 6, width: 20, height: 12 })
    applyTightSvgBox(svg, 'contain', 24)
    restore()
    expect(svg.getAttribute('viewBox')).toBe('2 6 20 12')
    expect(svg.getAttribute('width')).toBe('24')
    expect(svg.getAttribute('height')).toBe('14.4')
  })

  it('scales a wordmark so its height matches the given size', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    const restore = mockGetBBox({ x: 2, y: 2, width: 76, height: 20 })
    applyTightSvgBox(svg, 'height', 18)
    restore()
    expect(svg.getAttribute('viewBox')).toBe('2 2 76 20')
    expect(svg.getAttribute('height')).toBe('18')
    expect(svg.getAttribute('width')).toBe('68.4')
  })

  it('no-ops when getBBox is missing or empty', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('viewBox', '0 0 24 24')
    applyTightSvgBox(svg, 'contain', 24)
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24')
  })
})

describe('TightCombine', () => {
  afterEach(() => {
    delete (SVGElement.prototype as SVGElement & { getBBox?: unknown }).getBBox
  })

  it('uses a uniform gap of size * space multiple', () => {
    const { container } = render(<TightCombine Icon={FakeMark} Text={FakeText} size={28} />)
    const root = container.firstElementChild as HTMLElement
    expect(root).toHaveStyle({ gap: `${28 * TIGHT_COMBINE_SPACE_MULTIPLE}px` })
    expect(container.querySelectorAll('svg')).toHaveLength(2)
  })

  it('crops mark and text to their ink boxes', () => {
    const restore = mockGetBBox({ x: 2, y: 2, width: 20, height: 20 })
    const { container } = render(<TightCombine Icon={FakeMark} Text={FakeText} size={24} />)
    restore()
    const mark = container.querySelector('[data-testid="mark"]')
    const text = container.querySelector('[data-testid="text"]')
    expect(mark).toHaveAttribute('viewBox', '2 2 20 20')
    expect(text).toHaveAttribute('viewBox', '2 2 20 20')
    expect(text).toHaveAttribute('height', String(24 * TIGHT_COMBINE_TEXT_MULTIPLE))
  })

  it('re-crops after a parent rerender resets the svg viewBox', () => {
    const restore = mockGetBBox({ x: 2, y: 2, width: 20, height: 20 })
    const { container, rerender } = render(<TightCombine Icon={FakeMark} size={24} />)
    rerender(<TightCombine Icon={FakeMark} size={24} />)
    restore()
    expect(container.querySelector('[data-testid="mark"]')).toHaveAttribute('viewBox', '2 2 20 20')
  })

  it('renders an extra label instead of a wordmark', () => {
    const { container } = render(<TightCombine Icon={FakeMark} extra="ChatGPT" size={20} />)
    expect(container.textContent).toContain('ChatGPT')
    expect(container.querySelectorAll('svg')).toHaveLength(1)
  })
})

describe('ProviderLabel tight combine', () => {
  it('does not use official Combine margin for a branded row', () => {
    const { container } = render(<ProviderLabel brandKey="openai" combine size={28} />)
    const svgs = [...container.querySelectorAll('svg')]
    expect(svgs.length).toBeGreaterThanOrEqual(2)
    expect(svgs.some((el) => el.style.marginRight)).toBe(false)
    expect(container.firstElementChild).toHaveStyle({ gap: `${28 * TIGHT_COMBINE_SPACE_MULTIPLE}px` })
  })

  it('replaces the ChatGPT official Combine extra with TightCombine', () => {
    const { container } = render(<ProviderLabel brandKey="chatgpt" size={20} />)
    expect(container.textContent).toContain('ChatGPT')
    expect(container.querySelectorAll('svg')).toHaveLength(1)
  })
})
