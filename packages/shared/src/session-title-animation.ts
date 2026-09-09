/** One source for desktop CSS and the transient native-title WebView. */
export const SESSION_TITLE_OUT_MS = 220
export const SESSION_TITLE_STAGGER_MS = 55
export const SESSION_TITLE_FLIP_MS = 360
export const SESSION_TITLE_TAIL_MS = 120
export const sessionTitleAnimationCss = `
/* --- AnimatedSessionTitle: out → in char shimmer --- */
.animated-title-wrap {
  user-select: none;
}
.animated-title-wrap[data-phase="out"],
.animated-title-wrap[data-phase="in"] {
  perspective: 500px;
}
.animated-title-inner {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* Hover marquee: the wrap clips and the inner slides. Only while scrolling —
   \`overflow: hidden\` on the wrap would otherwise clip the 3D char flip. */
.animated-title-wrap[data-marquee="on"] {
  overflow: hidden;
}
.animated-title-wrap[data-marquee="on"] .animated-title-inner {
  width: max-content;
  overflow: visible;
  text-overflow: clip;
}
.animated-title-wrap[data-phase="out"] .animated-title-inner,
.animated-title-wrap[data-phase="in"] .animated-title-inner {
  transform-style: preserve-3d;
}
.animated-title-wrap[data-phase="out"] .animated-title-inner {
  opacity: 0;
  transform: translateY(-2px) scale(.94);
  filter: blur(1.5px);
  transition: opacity .22s ease, transform .22s cubic-bezier(.45,0,.25,1), filter .22s ease;
}
.animated-title-ch {
  display: inline-block;
  white-space: pre;
  transform-origin: 50% 100%;
}
.animated-title-ch.is-flip {
  opacity: 0;
  backface-visibility: hidden;
  animation: animated-title-flip .36s cubic-bezier(.2,0,.2,1) forwards;
}
@keyframes animated-title-flip {
  0%   { opacity: 0; transform: rotateX(-80deg) translateY(2px); color: var(--primary); text-shadow: 0 0 8px color-mix(in oklch, var(--primary) 55%, transparent); }
  55%  { opacity: 1; transform: rotateX(0deg); color: var(--primary); text-shadow: 0 0 4px color-mix(in oklch, var(--primary) 30%, transparent); }
  100% { opacity: 1; transform: rotateX(0deg); color: inherit; text-shadow: none; }
}
`
