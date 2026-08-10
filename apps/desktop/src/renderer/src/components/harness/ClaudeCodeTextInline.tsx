/**
 * One-line wordmark derived from @lobehub/icons `ClaudeCode.Text`.
 *
 * Upstream SVG stacks "CLAUDE" over "CODE". We re-place the CODE subpaths
 * to the right of CLAUDE so detail headers can use the brand on a single row.
 *
 * Glyph paths are tightly cropped (source height ~10.7). LobeHub `*.Text`
 * icons use a 24-tall viewBox with ~22 of glyph fill — we scale into that
 * same canvas so `size` matches Codex/Grok/OpenCode wordmarks.
 */
import type { CSSProperties, SVGProps } from 'react'

/** Tight-cropped one-line path bounds (pre-scale). */
const SRC_W = 92.57
const SRC_H = 10.7

/** Match @lobehub/icons Text viewBox height + Codex-like glyph fill. */
const CANVAS_H = 24
const GLYPH_H = 22
const SCALE = GLYPH_H / SRC_H
const PAD_Y = (CANVAS_H - GLYPH_H) / 2
const VIEW_W = SRC_W * SCALE

const PATH_D =
  'M6.786 0v.786h.67v2.31H2.614v4.505h4.172v.786h.67v2.31h-6.19V9.56h-.298v-.762h-.67V7.66H0V1.9h.968V0h5.818zm0 8.66h.417v1.764H1.519V9.56h-.126v1.002h5.936V8.524h-.543v.137zm0 .9h-5.14v.727h5.43v-1.49h-.29v.762zm-6.362-.9h.544v-.136h-.417v-.865h-.127v1.002zm.253-.273h.291V7.66h-.29v.728zm6.109-6.429H1.944v5.643h.29V2.686h4.842v-1.49h-.29v.762zm0-.899h.417v1.764H2.36V7.6h.126V2.96H7.33V0.923h-.543v.136zM10.66 0.786h.67V7.6h4.17v.786h.671v2.31h-7.158V9.56h-.298V0h1.944v.786zM15.5 8.66h.418v1.763h-6.652V9.56h-.127v1.002h6.905V8.524h-.543v.137zm0 .898h-6.107v.728h6.398v-1.49h-.29v.762zm-4.84-1.958h.29V1.196h-.29v6.405zm0-6.542h.416v6.542h.127V0.923h-.544v.136zM23.248 0.786h.67V1.9h.298v.786h.67v8.012H22.57V9.559h-.298V6.897h-2.228v3.8h-2.316V9.56h-.298V1.9h.969V0h4.849v.786zm-3.457 9.638h-1.81V9.56h-.127v1.002h2.064v-3.8h2.354v-.137h-2.48v3.8zm4.425-7.464h.417v7.464h-1.81V9.56h-.127v1.002h2.063V2.823h-.543v.137zm-4.842 6.6h-1.266v.727h1.556v-3.8h2.608v-.728h-2.898v3.8zm4.842 0h-1.267v.727h1.557v-7.19h-.29v6.462zM19.374 3.8h.29V2.687h2.608v-.728h-2.898v1.843zm.417 0h.127v-.84h2.354v-.137h-2.48V3.8zm.253 0h2.228v-.704h-2.228v.705zm3.204-1.9h.29v-.704h-.29V1.9zm0-.84h.416v.84h.127V0.923h-.543v.136zM28.09 0.786h.67V7.6h3.196V0H33.9v.786h.67v8.011H33.6v1.9h-6.19V9.56h-.297v-.762h-.671V7.66h-.298V0h1.945v.786zm5.81.273h.416v7.465h-.968v1.9h-5.683V9.56h-.127v1.002h5.937v-1.9h.968V0.923H33.9v.136zm0 6.6h-.969v1.9h-5.14v.728h5.43v-1.9h.969v-7.19h-.29v6.462zm-7.33 1.002h.544v-.137h-.418v-.865h-.126v1.002zm.253-.274h.29V7.66h-.29v.728zm1.267-.786h.29V1.196h-.29v6.405zm0-6.542h.416v6.542h.127V0.923h-.543v.136zM41.647 0.786h.67V1.9h.298v.786h.67v6.111h-.969v1.9h-6.19V9.56h-.297V0h5.818v.786zm.968 2.174h.417v5.564h-.969v1.9H36.38V9.56h-.127v1.002h5.937v-1.9h.968V2.823h-.543v.137zm0 4.7h-.968v1.9h-5.14v.727h5.43v-1.9h.968v-5.29h-.29v4.562zM37.773 7.6h.29V2.686h2.608v-.728h-2.898v5.643zm.417 0h.127V2.96h2.354v-.137H38.19V7.6zm.253 0h2.228V3.096h-2.228v4.505zm3.204-5.7h.29v-.705h-.29V1.9zm0-.842h.416V1.9h.127V0.923h-.543v.136zM51.33 0.786H52v2.31h-4.842v.705h2.235v.785h.67v2.311h-2.905v.704h4.172v.786H52v2.31h-7.158V9.56h-.298V0h6.786v.786zm0 7.875h.417v1.763h-6.652V9.56h-.127v1.002h6.905V8.524h-.543v.137zm0 .898h-6.108v.728h6.398v-1.49h-.29v.762zm-1.937-3.8h-2.905V7.6h.29V6.487h2.906v-1.49h-.29v.762zm0-.899h.417v1.764h-2.905V7.6h.127v-.84h2.905V4.722h-.544v.137zm1.937-2.902h-4.842v1.843h.29V2.686h4.842v-1.49h-.29v.762zm0-.899h.417v1.764h-4.842V3.8h.127V2.96h4.841V0.923h-.543v.136zM64.786 0.786h.67v2.31H60.614v4.506h4.172v.785h.67V10.698h-6.19v-1.138h-.298V8.798h-.67V7.658H58v-5.758h.968v-1.9h5.818v.785zm0 7.875h.417v1.763H59.519v-.864h-.126v1.001h5.936v-2.037h-.543v.137zm0 .899h-5.14v.728h5.43V8.798h-.29v.762zm-6.362-.9h.544v-.136h-.417v-.865h-.127v1.002zm.253-.273h.291v-.728h-.29v.728zm6.109-6.429H59.944v5.644h.29v-4.916h4.842v-1.49h-.29v.762zm0-.898h.417v1.763H60.36v4.779h.126v-4.642H65.33v-2.037h-.543v.137zM73.5 0.786h.671v1.115h.298v.785h.67V8.798h-.968V10.698h-6.19v-1.138h-.297V8.798h-.671V7.658h-.298v-5.758h.969v-1.9H73.5v.785zm.97 2.174h.416v5.564h-.968v1.9h-5.684v-.864h-.126v1.001h5.936v-1.9h.969v-5.838h-.544v.137zm0 4.7h-.97v1.9h-5.14v.728h5.431v-1.9h.969v-5.291h-.29v4.562zm-7.33 1h.544v-.136h-.418v-.865h-.127v1.002zm.252-.273h.292v-.728h-.291v.728zm1.267-.785h.29v-4.916h3.576v-.728H68.66v5.644zm.417 0h.127v-4.642h3.322v-.137h-3.449v4.779zm.253 0h3.196v-4.505H69.33v4.505zm4.172-5.701h.29v-.705h-.29v.705zm0-.841h.417v.84h.126v-.977h-.543v.137zM82.216 0.786h.67v1.115h.298v.785h.67V8.798h-.968V10.698h-6.19v-1.138H76.4v-9.56h5.817v.786zm.968 2.174h.417v5.564h-.968v1.9H76.95v-.864h-.127v1.001h5.936v-1.9h.969v-5.838h-.544v.137zm0 4.7h-.968v1.9h-5.14v.728h5.43v-1.9h.969v-5.291h-.29v4.562zm-4.841-.058h.29v-4.916h2.607v-.728h-2.897v5.644zm.416 0h.127v-4.642h2.354v-.137h-2.48v4.779zm.254 0h2.227v-4.505h-2.227v4.505zm3.203-5.701h.29v-.705h-.29v.705zm0-.841h.417v.84h.127v-.977h-.544v.137zM91.9 0.786h.67v2.31h-4.842v.705h2.235v.786h.67v2.31h-2.905v.704H91.9v.786h.67V10.698H85.41v-1.138h-.297v-9.56H91.9v.786zm0 7.875h.416v1.763h-6.651v-.864h-.127v1.001h6.905v-2.037H91.9v.137zm0 .899H85.79v.728h6.399V8.798h-.29v.762zm-1.937-3.801h-2.905v1.843h.29v-1.115h2.905v-1.49h-.29v.762zm0-.899h.417v1.764h-2.905v.978h.126v-.841h2.905v-2.037h-.543v.136zM91.9 1.958h-4.842v1.843h.29v-1.115h4.842v-1.49h-.29v.762zm0-.898h.416v1.763h-4.841v.978h.126v-.841h4.842v-2.037H91.9v.137z'

export function ClaudeCodeTextInline({
  size = 28,
  style,
  ...rest
}: {
  size?: number | string
  style?: CSSProperties
} & Omit<SVGProps<SVGSVGElement>, 'width' | 'height' | 'viewBox'>) {
  const height = size
  const width =
    typeof size === 'number'
      ? (size * VIEW_W) / CANVAS_H
      : `calc(${size} * ${VIEW_W / CANVAS_H})`

  return (
    <svg
      fill="currentColor"
      fillRule="evenodd"
      height={height}
      width={width}
      viewBox={`0 0 ${VIEW_W} ${CANVAS_H}`}
      xmlns="http://www.w3.org/2000/svg"
      style={{ flex: 'none', lineHeight: 1, ...style }}
      aria-label="Claude Code"
      role="img"
      {...rest}
    >
      <title>Claude Code</title>
      <g transform={`translate(0 ${PAD_Y}) scale(${SCALE})`}>
        <path clipRule="evenodd" d={PATH_D} />
      </g>
    </svg>
  )
}
