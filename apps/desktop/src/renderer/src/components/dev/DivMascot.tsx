import React from 'react'

const BODY = '#E07B4A'
const EYE = '#1a1a1a'

const px = (n: number): React.CSSProperties['width'] => `${n}px`

export const DIV_MASCOT_CSS = `
.bm-float { animation: bm-float 2.5s ease-in-out infinite; }
.bm-eyes  { animation: bm-blink 5s ease-in-out infinite; }
.bm-leg   { transform-origin: center top; }
.bm-legA  { animation: bm-legA 2.5s ease-in-out infinite; }
.bm-legB  { animation: bm-legB 2.5s ease-in-out infinite; }
@keyframes bm-float { 0%,100%{transform:translate(0,0)} 25%{transform:translate(2px,-2px)} 50%{transform:translate(0,0)} 75%{transform:translate(-2px,-2px)} }
@keyframes bm-blink { 0%,90%,100%{opacity:1} 95%{opacity:0} }
@keyframes bm-legA  { 0%,100%{transform:scaleY(1)} 50%{transform:scaleY(1.2)} }
@keyframes bm-legB  { 0%,100%{transform:scaleY(1)} 50%{transform:scaleY(0.8)} }
`

const part = (style: React.CSSProperties): React.CSSProperties => ({ position: 'absolute', background: BODY, ...style })

export function DivMascot({ size }: { size: number }) {
  const scale = size / 116
  return (
    <span style={{ display: 'inline-block', width: px(size), height: px(90 * scale), position: 'relative' }}>
      <div style={{ position: 'absolute', width: px(116), height: px(90), transformOrigin: 'top left', transform: `scale(${scale})` }}>
        <div className="bm-float" style={{ position: 'absolute', inset: 0 }}>
          <div style={part({ left: 10, top: 0, width: 90, height: 60 })} />
          <div style={part({ left: 0, top: 20, width: 10, height: 20 })} />
          <div style={part({ left: 100, top: 20, width: 10, height: 20 })} />
          <div className="bm-eyes" style={{ position: 'absolute', inset: 0 }}>
            <div style={part({ left: 20, top: 20, width: 10, height: 10, background: EYE })} />
            <div style={part({ left: 80, top: 20, width: 10, height: 10, background: EYE })} />
          </div>
          <div className="bm-leg bm-legA" style={part({ left: 10, top: 58, width: 10, height: 22 })} />
          <div className="bm-leg bm-legA" style={part({ left: 30, top: 58, width: 10, height: 22 })} />
          <div className="bm-leg bm-legB" style={part({ left: 70, top: 58, width: 10, height: 22 })} />
          <div className="bm-leg bm-legB" style={part({ left: 90, top: 58, width: 10, height: 22 })} />
        </div>
      </div>
    </span>
  )
}
