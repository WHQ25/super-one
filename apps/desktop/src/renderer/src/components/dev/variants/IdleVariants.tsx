import React from 'react'

export const VARIANT_CSS = `
@keyframes cv-float { 0%,100%{transform:translate(0,0)} 25%{transform:translate(2px,-2px)} 50%{transform:translate(0,0)} 75%{transform:translate(-2px,-2px)} }
@keyframes cv-blink { 0%,90%,100%{opacity:1} 95%{opacity:0} }
@keyframes cv-leg-l { 0%,100%{transform:scaleY(1)} 50%{transform:scaleY(1.2)} }
@keyframes cv-leg-r { 0%,100%{transform:scaleY(1)} 50%{transform:scaleY(0.8)} }
.cv-leg { transform-box: fill-box; transform-origin: center top; }
@keyframes xv-scale { 0%,100%{transform:scale(1)} 50%{transform:scale(1.04)} }
@keyframes xv-cursor { 0%,48%,100%{opacity:1} 50%,98%{opacity:0} }
@keyframes xv-warm { 0%,100%{opacity:0.7} 50%{opacity:1} }
@keyframes xv-spec { 0%,100%{opacity:0.65} 50%{opacity:1} }
.cv-outer, .xv-outer { display: inline-flex; will-change: transform; }
.cv-outer { animation: cv-float 2.5s ease-in-out infinite; }
.xv-outer { animation: xv-scale 2.5s ease-in-out infinite; }
`

export interface VariantProps {
  size?: number
  crispEdges: boolean
  outerFloat: boolean
}

function wrapStyle(size?: number) {
  return size ? { width: size, height: size } : undefined
}
function svgStyle(size?: number) {
  return size ? { width: size - 2, height: size - 2 } : undefined
}

export function ClaudeIdle({ size, crispEdges, outerFloat }: VariantProps) {
  const svg = (
    <svg
      viewBox="-3 -3 116 90"
      className="w-3 h-3 overflow-visible"
      style={svgStyle(size)}
      {...(crispEdges ? { shapeRendering: 'crispEdges' as const } : {})}
    >
      <g style={outerFloat ? undefined : { transformOrigin: '55px 40px', animation: 'cv-float 2.5s ease-in-out infinite' }}>
        <g fill="#E07B4A">
          <rect x="10" y="0" width="90" height="60" />
          <rect x="0" y="20" width="10" height="20" />
          <rect x="100" y="20" width="10" height="20" />
        </g>
        <g fill="#1a1a1a" style={{ transformOrigin: '50px 25px', animation: 'cv-blink 5s ease-in-out infinite' }}>
          <rect x="20" y="20" width="10" height="10" />
          <rect x="80" y="20" width="10" height="10" />
        </g>
        <g fill="#E07B4A">
          <rect className="cv-leg" x="10" y="58" width="10" height="22" style={{ animation: 'cv-leg-l 2.5s ease-in-out infinite' }} />
          <rect className="cv-leg" x="30" y="58" width="10" height="22" style={{ animation: 'cv-leg-l 2.5s ease-in-out infinite' }} />
          <rect className="cv-leg" x="70" y="58" width="10" height="22" style={{ animation: 'cv-leg-r 2.5s ease-in-out infinite' }} />
          <rect className="cv-leg" x="90" y="58" width="10" height="22" style={{ animation: 'cv-leg-r 2.5s ease-in-out infinite' }} />
        </g>
      </g>
    </svg>
  )
  return (
    <span className="inline-flex items-center justify-center w-3.5 h-3.5" style={wrapStyle(size)}>
      {outerFloat ? <span className="cv-outer">{svg}</span> : svg}
    </span>
  )
}

const CLOUD =
  'M9.064 3.344a4.578 4.578 0 012.285-.312c1 .115 1.891.54 2.673 1.275.01.01.024.017.037.021a.09.09 0 00.043 0 4.55 4.55 0 013.046.275l.047.022.116.057a4.581 4.581 0 012.188 2.399c.209.51.313 1.041.315 1.595a4.24 4.24 0 01-.134 1.223.123.123 0 00.03.115c.594.607.988 1.33 1.183 2.17.289 1.425-.007 2.71-.887 3.854l-.136.166a4.548 4.548 0 01-2.201 1.388.123.123 0 00-.081.076c-.191.551-.383 1.023-.74 1.494-.9 1.187-2.222 1.846-3.711 1.838-1.187-.006-2.239-.44-3.157-1.302a.107.107 0 00-.105-.024c-.388.125-.78.143-1.204.138a4.441 4.441 0 01-1.945-.466 4.544 4.544 0 01-1.61-1.335c-.152-.202-.303-.392-.414-.617a5.81 5.81 0 01-.37-.961 4.582 4.582 0 01-.014-2.298.124.124 0 00.006-.056.085.085 0 00-.027-.048 4.467 4.467 0 01-1.034-1.651 3.896 3.896 0 01-.251-1.192 5.189 5.189 0 01.141-1.6c.337-1.112.982-1.985 1.933-2.618.212-.141.413-.251.601-.33.215-.089.43-.164.646-.227a.098.098 0 00.065-.066 4.51 4.51 0 01.829-1.615 4.535 4.535 0 011.837-1.388z'

export function CodexIdle({ size, crispEdges, outerFloat }: VariantProps) {
  const svg = (
    <svg viewBox="1 1 22 22" className="w-3 h-3 overflow-visible" style={svgStyle(size)} {...(crispEdges ? { shapeRendering: 'crispEdges' as const } : {})}>
      <defs>
        <radialGradient id="xv-base" cx="8" cy="6" r="22" fx="6" fy="3" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FAFAFF" />
          <stop offset="28%" stopColor="#B1A7FF" />
          <stop offset="62%" stopColor="#4F6BE8" />
          <stop offset="100%" stopColor="#241889" />
        </radialGradient>
        <radialGradient id="xv-warm-grad" cx="18" cy="20" r="15" fx="20" fy="22" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#D14EE8" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#5530B0" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="xv-spec-grad" cx="7" cy="4" r="5" fx="7" fy="3" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
        </radialGradient>
      </defs>
      <g transform="translate(12 12)">
        <g style={outerFloat ? { transformOrigin: 'center center' } : { transformOrigin: 'center center', animation: 'xv-scale 2.5s ease-in-out infinite' }}>
          <g transform="translate(-12 -12)">
            <path d={CLOUD} fill="url(#xv-base)" />
            <path d={CLOUD} fill="url(#xv-warm-grad)" style={{ animation: 'xv-warm 5s ease-in-out infinite' }} />
            <path d={CLOUD} fill="url(#xv-spec-grad)" style={{ animation: 'xv-spec 5s ease-in-out infinite' }} />
            <path d="M8.462 9.23a.637.637 0 00-1.106.631l1.272 2.224-1.266 2.136a.636.636 0 101.095.649l1.454-2.455a.636.636 0 00.005-.64L8.462 9.23z" fill="#fff" />
            <path d="M12.546 13.909a.637.637 0 000 1.272h3.636a.637.637 0 100-1.272h-3.636z" fill="#fff" style={{ animation: 'xv-cursor 1.25s step-end infinite' }} />
          </g>
        </g>
      </g>
    </svg>
  )
  return (
    <span className="inline-flex items-center justify-center w-3.5 h-3.5" style={wrapStyle(size)}>
      {outerFloat ? <span className="xv-outer">{svg}</span> : svg}
    </span>
  )
}
