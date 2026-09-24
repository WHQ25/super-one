/**
 * The document a widget actually runs in, and the bridge it talks to its host through.
 *
 * Shared because both surfaces mount the *same* agent-authored code: the desktop chat in
 * an `<iframe sandbox="allow-scripts">`, and the phone in a nested iframe inside the chat
 * WebView. A widget that resizes, calls `sendPrompt`, or opens a link has to behave
 * identically on both, so the script that defines those affordances lives in one place
 * rather than being reimplemented per surface.
 */
import { SVG_STYLES } from './svg-styles'
import { rewriteCdnUrls } from './cdn-allowlist'

export const WIDGET_MESSAGE_TYPES = [
  'widget-ready',
  'widget-resize',
  'widget-sendPrompt',
  'widget-openLink',
  'widget-wheel',
  'widget-touch-scroll',
] as const

export type WidgetMessageType = (typeof WIDGET_MESSAGE_TYPES)[number]

/**
 * The width a host gives the widget iframe: its container's width, floored to a whole pixel.
 *
 * A frame's viewport is snapped to the pixel grid on its own, so a fractional box (say
 * 600.25px) lays its document out at 600.5px and clips the overflow at the frame edge.
 * A widget that fills the frame loses its right edge — typically a hairline border.
 */
export const WIDGET_FRAME_WIDTH = 'round(down, 100%, 1px)'

export function widgetBodyStyle(isSVG: boolean): string {
  return isSVG
    ? 'margin:0;display:flex;align-items:center;justify-content:center;min-height:100%;background:transparent;color:var(--color-text-primary);'
    : 'margin:0;font-family:system-ui,-apple-system,sans-serif;background:transparent;color:var(--color-text-primary);'
}

/**
 * A touch that lands on a control belongs to the widget; anything else is the user
 * trying to scroll the transcript underneath it. Without this split a widget that
 * fills the screen becomes a scroll trap on a phone — and forwarding every touch
 * instead would break every slider and button a widget ships.
 */
const TOUCH_SCROLL_SCRIPT = `
  var interactive='input,select,textarea,button,a,canvas,[role=button],[role=slider],[onclick],[data-interactive]';
  var startY=0,forwarding=false;
  document.addEventListener('touchstart',function(e){
    var t=e.touches[0];
    startY=t?t.clientY:0;
    forwarding=!(e.target&&e.target.closest&&e.target.closest(interactive));
  },{passive:true});
  document.addEventListener('touchmove',function(e){
    if(!forwarding)return;
    var t=e.touches[0];
    if(!t)return;
    var dy=startY-t.clientY;
    startY=t.clientY;
    if(dy)parent.postMessage({type:'widget-touch-scroll',deltaY:dy},'*');
  },{passive:true});
`

function bridgeScript(touchScroll: boolean): string {
  return `<script>
(function(){
  window.addEventListener('message',function(e){
    var d=e.data;
    if(!d||d.type!=='widget-theme')return;
    document.documentElement.classList.toggle('dark',!!d.dark);
    if(d.colorScheme)document.documentElement.style.colorScheme=d.colorScheme;
    if(d.vars)for(var k in d.vars)document.documentElement.style.setProperty(k,d.vars[k]);
  });
  window.sendPrompt=function(t){parent.postMessage({type:'widget-sendPrompt',text:String(t)},'*')};
  window.openLink=function(u){parent.postMessage({type:'widget-openLink',url:String(u)},'*')};
  document.addEventListener('click',function(e){
    var a=e.target.closest('a[href]');
    if(a&&/^https?:/.test(a.href)){e.preventDefault();openLink(a.href)}
  });
  new ResizeObserver(function(){var h=document.body.offsetHeight;if(h>0)parent.postMessage({type:'widget-resize',height:h},'*')}).observe(document.body);
  document.documentElement.style.overflow='hidden';
  document.body.style.overflow='hidden';
  window.addEventListener('wheel',function(e){parent.postMessage({type:'widget-wheel',deltaX:e.deltaX,deltaY:e.deltaY,deltaMode:e.deltaMode},'*')},{passive:true});
${touchScroll ? TOUCH_SCROLL_SCRIPT : ''}
  parent.postMessage({type:'widget-ready'},'*');
})();
</script>`
}

/**
 * The widget palette re-pointed at the host's own theme tokens.
 *
 * `SVG_STYLES` ships a fixed warm-neutral palette that has nothing to do with
 * SuperOne's: in light mode a widget card is `#F5F1EA` cream sitting on a cool
 * near-white transcript, and in dark it is a grey struck a different way. Any
 * widget that follows the manual and puts content on `--color-background-secondary`
 * therefore reads as a slab pasted into the conversation rather than part of it.
 *
 * The keys are the widget-facing contract (documented in the widget manual); the
 * values come from whatever the host resolved for its own surfaces, so a widget
 * inherits the transcript's exact colours — including the per-harness brand hue —
 * instead of approximating them.
 */
export const WIDGET_THEME_TOKEN_SOURCES = {
  '--color-background-primary': '--card',
  '--color-background-secondary': '--muted',
  /**
   * Not `--background`, even though the widget contract calls this one "page bg": the
   * widget body is transparent, so the page *is* the transcript's background, and a
   * meter track or chart gridline painted in it would be invisible. Every widget fill
   * has to sit above that backdrop, and `--card` is the nearest step up that stays
   * distinct from the surface tone above.
   */
  '--color-background-tertiary': '--card',
  '--color-text-primary': '--foreground',
  '--color-text-secondary': '--muted-foreground',
  '--color-text-tertiary': '--muted-foreground',
  '--color-border-primary': '--border',
  '--color-border-secondary': '--border',
  '--color-border-tertiary': '--border',
  // Short aliases the older diagram styles still read.
  '--p': '--foreground',
  '--s': '--muted-foreground',
  '--t': '--muted-foreground',
  '--bg2': '--muted',
  '--b': '--border',
} as const satisfies Record<string, string>

/**
 * Resolve the host's tokens into the widget contract. `read` is the host's own
 * lookup — a computed style in a DOM, or a fixed map in a test. A token the host
 * cannot resolve is skipped so the widget keeps the built-in default rather than
 * being handed an empty string.
 */
export function widgetThemeVars(read: (token: string) => string): Record<string, string> {
  const vars: Record<string, string> = {}
  for (const [target, source] of Object.entries(WIDGET_THEME_TOKEN_SOURCES)) {
    const value = read(source).trim()
    if (value) vars[target] = value
  }
  return vars
}

export interface WidgetSrcdocOptions {
  /**
   * Forward non-interactive vertical drags to the host so the transcript keeps
   * scrolling under the widget. Touch surfaces only; a desktop widget scrolls
   * through the wheel bridge instead.
   */
  touchScroll?: boolean
  /**
   * The `color-scheme` the **embedding document** declares, when it declares one.
   *
   * This is not a styling preference — it decides whether the frame is see-through
   * at all. An iframe is only composited transparently while its used colour scheme
   * matches its parent's; the moment they differ the engine paints the frame's own
   * opaque canvas underneath (white for a light frame, near-black for a dark one) so
   * that mismatched text cannot land on an unreadable backdrop.
   *
   * A widget document declares nothing, so it is light. The desktop transcript also
   * declares nothing, so the two match and the frame disappears into the page — which
   * is why this only ever went wrong on the phone, whose chat document stamps
   * `color-scheme` from the host theme and so ends up dark against a light frame.
   *
   * Leave it unset when the host declares none: adding a scheme the parent does not
   * have re-creates the mismatch in the other direction.
   */
  colorScheme?: 'light' | 'dark'
}

export function buildWidgetSrcdoc(
  code: string,
  isSVG: boolean,
  options: WidgetSrcdocOptions = {},
): string {
  const safeCode = rewriteCdnUrls(code)
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<style>*{box-sizing:border-box}${options.colorScheme ? `html{color-scheme:${options.colorScheme}}` : ''}body{${widgetBodyStyle(isSVG)}}${SVG_STYLES}</style>
</head><body>${safeCode}${bridgeScript(options.touchScroll === true)}</body></html>`
}
