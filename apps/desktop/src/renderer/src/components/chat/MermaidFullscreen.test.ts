import { describe, it, expect } from 'vitest'
import { parseSvgSize } from './MermaidFullscreen'

describe('parseSvgSize', () => {
  it('extracts dimensions from viewBox', () => {
    const svg = '<svg viewBox="0 0 800 2000" xmlns="http://www.w3.org/2000/svg"></svg>'
    expect(parseSvgSize(svg)).toEqual({ width: 800, height: 2000 })
  })

  it('handles decimal viewBox values from mermaid output', () => {
    const svg = '<svg id="m1" viewBox="0 0 843.87890625 2178.140625"></svg>'
    expect(parseSvgSize(svg)).toEqual({ width: 843.87890625, height: 2178.140625 })
  })

  it('handles comma-separated viewBox', () => {
    const svg = '<svg viewBox="0,0,640,480"></svg>'
    expect(parseSvgSize(svg)).toEqual({ width: 640, height: 480 })
  })

  it('falls back to width/height attrs when viewBox is missing', () => {
    const svg = '<svg width="1024" height="768"></svg>'
    expect(parseSvgSize(svg)).toEqual({ width: 1024, height: 768 })
  })

  it('uses viewBox over width/height attrs when both present', () => {
    // mermaid outputs viewBox + width="100%" which should be ignored
    const svg = '<svg width="100%" viewBox="0 0 800 600"></svg>'
    expect(parseSvgSize(svg)).toEqual({ width: 800, height: 600 })
  })

  it('returns 800x600 default when nothing is available', () => {
    expect(parseSvgSize('<svg></svg>')).toEqual({ width: 800, height: 600 })
  })

  it('ignores zero or negative viewBox dimensions', () => {
    // parseSvgSize rejects zero; should fall through to width/height or default
    const svg = '<svg viewBox="0 0 0 0" width="500" height="400"></svg>'
    expect(parseSvgSize(svg)).toEqual({ width: 500, height: 400 })
  })
})
