/**
 * Offline HTML the mermaid preview WebView loads. The SVG is data, never
 * markup: JSON-encoded and written through innerHTML so a diagram cannot
 * break out of the document.
 *
 * Pinch and pan are the WebView's native page zoom, the same mechanism as the
 * transcript, so the vector is re-tiled at the current scale while the
 * fingers are still down. CSS-transform zoom cannot do that: the transformed
 * layer keeps the raster it was painted at and blurs until layout. The zoom
 * belongs to this preview WebView alone, so dismissing it cannot leave the
 * chat WebView scaled.
 *
 * Double-tap is ours: WebKit's smart zoom fits the tapped block, which here
 * is the whole stage, so it lands off-centre. `touch-action:manipulation`
 * turns it off and a tap pair pins min/max/initial scale to force the native
 * zoom. Chromium ignores a viewport change unless `initial-scale` changes, so
 * the pin sits a hair above the exact value every release writes. The pin is
 * released once the visual viewport reaches it (releasing mid-animation
 * freezes WebKit's zoom partway), and the engines need different releases:
 * WebKit must get the page's own `initial-scale` back or it re-animates to a
 * wrong scale, and moves to the tapped point with `scrollTo`; Chromium needs
 * a changed `initial-scale` to lift min/max, so it releases at the target,
 * which resets its scroll and leaves only `scrollIntoView` able to move the
 * visual viewport.
 *
 * The stage has a definite size because mermaid emits `width="100%"` with no
 * intrinsic width: inside a shrink-to-fit box that percentage collapses to 0.
 * The SVG fills the stage, its viewBox fits the drawing, and mermaid's inline
 * `max-width` keeps a small diagram at its natural size. The page is exactly
 * one screen, so at 1× there is nothing to scroll.
 */

const MIN_SCALE = 1
const MAX_SCALE = 10

export function mermaidPreviewDocument(svg: string, background: string, chromium: boolean): string {
  const data = JSON.stringify({ svg, background }).replace(/</g, '\\u003c')
  return `<!doctype html><html><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=${MIN_SCALE}, minimum-scale=${MIN_SCALE}, maximum-scale=${MAX_SCALE}, viewport-fit=cover"/>
<style>
html,body{margin:0;width:100%;height:100%;touch-action:manipulation;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
body{display:flex;align-items:center;justify-content:center;background:transparent}
#stage{width:92vw;height:78vh}
#stage svg{display:block;width:100%;height:100%;margin:0 auto}
#focus{position:absolute;width:1px;height:1px;pointer-events:none}
</style></head><body>
<div id="stage"></div><div id="focus" aria-hidden="true"></div>
<script>
const config=${data};
document.body.style.background=config.background;
document.getElementById('stage').innerHTML=config.svg;
const meta=document.querySelector('meta[name=viewport]'),focus=document.getElementById('focus');
const MIN=${MIN_SCALE},MAX=${MAX_SCALE},CHROMIUM=${chromium},PIN_OFFSET=0.001,DOUBLE=2.5,TAP_MS=300,TAP_SLOP=24,MOVE_SLOP=10,SETTLE_MS=1000;
let lastTap=0,lastX=0,lastY=0,startX=0,startY=0,moved=false;
function setViewport(initial,min,max){meta.content='width=device-width, initial-scale='+initial+', minimum-scale='+min+', maximum-scale='+max+', viewport-fit=cover'}
function zoomTo(scale,pageX,pageY){
  const root=document.documentElement,pin=scale+PIN_OFFSET,width=root.clientWidth/pin,height=root.clientHeight/pin,started=Date.now();
  setViewport(pin,pin,pin);
  const settle=()=>{
    if(Math.abs(visualViewport.width-width)>1&&Date.now()-started<SETTLE_MS){requestAnimationFrame(settle);return}
    setViewport(CHROMIUM?scale:MIN,MIN,MAX);
    if(scale<=1)return;
    if(!CHROMIUM){window.scrollTo(pageX-width/2,pageY-height/2);return}
    focus.style.left=pageX+'px';focus.style.top=pageY+'px';
    focus.scrollIntoView({block:'center',inline:'center'});
  };
  requestAnimationFrame(settle);
}
document.addEventListener('touchstart',event=>{
  moved=event.touches.length>1;
  startX=event.touches[0].clientX;startY=event.touches[0].clientY;
},{passive:true});
document.addEventListener('touchmove',event=>{
  if(event.touches.length>1||Math.hypot(event.touches[0].clientX-startX,event.touches[0].clientY-startY)>MOVE_SLOP)moved=true;
},{passive:true});
document.addEventListener('touchend',event=>{
  if(event.touches.length||moved)return;
  const tap=event.changedTouches[0],now=Date.now();
  if(now-lastTap<TAP_MS&&Math.hypot(tap.clientX-lastX,tap.clientY-lastY)<TAP_SLOP){
    lastTap=0;
    zoomTo(visualViewport.scale>1.01?1:DOUBLE,tap.pageX,tap.pageY);
    return;
  }
  lastTap=now;lastX=tap.clientX;lastY=tap.clientY;
},{passive:true});
</script></body></html>`
}
