import { useLayoutEffect, useRef, type ComponentType, type ReactNode } from 'react'

export const TIGHT_COMBINE_TEXT_MULTIPLE = 0.75
export const TIGHT_COMBINE_SPACE_MULTIPLE = 0.4

type Fit = 'contain' | 'height'

function fmt(n: number): string {
  return String(Math.round(n * 100) / 100)
}

/** Crop an SVG to its ink box, then size it. `contain` = max side is `size`; `height` = height is `size`. */
export function applyTightSvgBox(svg: SVGSVGElement, fit: Fit, size: number): void {
  const getBBox = svg.getBBox
  if (typeof getBBox !== 'function') return
  let box: DOMRect
  try {
    box = getBBox.call(svg)
  } catch {
    return
  }
  if (!box.width || !box.height) return

  svg.setAttribute('viewBox', `${box.x} ${box.y} ${box.width} ${box.height}`)
  const w = fit === 'contain'
    ? size * (box.width / Math.max(box.width, box.height))
    : size * (box.width / box.height)
  const h = fit === 'contain'
    ? size * (box.height / Math.max(box.width, box.height))
    : size
  svg.setAttribute('width', fmt(w))
  svg.setAttribute('height', fmt(h))
  svg.style.width = `${fmt(w)}px`
  svg.style.height = `${fmt(h)}px`
  svg.style.flex = 'none'
  svg.style.display = 'block'
}

function TightSvg({
  fit,
  size,
  children,
}: {
  fit: Fit
  size: number
  children: ReactNode
}) {
  const ref = useRef<HTMLSpanElement>(null)
  // Recrop after every commit — lobehub Icon resets viewBox/width on rerender.
  useLayoutEffect(() => {
    const svg = ref.current?.querySelector('svg')
    if (svg) applyTightSvgBox(svg, fit, size)
  })
  return (
    <span ref={ref} className="inline-flex shrink-0 leading-none">
      {children}
    </span>
  )
}

type IconComp = ComponentType<{ size?: number }>

export function TightCombine({
  Icon,
  Text,
  extra,
  size = 24,
}: {
  Icon: IconComp
  Text?: IconComp
  extra?: string
  size?: number
}) {
  const textSize = size * TIGHT_COMBINE_TEXT_MULTIPLE
  return (
    <span
      className="inline-flex items-center"
      style={{ gap: size * TIGHT_COMBINE_SPACE_MULTIPLE }}
    >
      <TightSvg fit="contain" size={size}>
        <Icon size={size} />
      </TightSvg>
      {Text ? (
        <TightSvg fit="height" size={textSize}>
          <Text size={textSize} />
        </TightSvg>
      ) : extra ? (
        <span className="leading-none" style={{ fontSize: textSize * 0.95 }}>{extra}</span>
      ) : null}
    </span>
  )
}
