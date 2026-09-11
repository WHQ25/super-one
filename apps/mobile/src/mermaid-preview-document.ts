/**
 * Offline HTML the mermaid preview WebView loads. The SVG is data, never
 * markup: JSON-encoded and written through innerHTML so a diagram cannot
 * break out of the document. Page zoom is off (`user-scalable=no`); pinch
 * and pan are CSS transforms on this page alone, so dismissing the preview
 * cannot leave the chat WebView scaled.
 */

export function mermaidPreviewDocument(svg: string, background: string): string {
  const data = JSON.stringify({ svg, background }).replace(/</g, '\\u003c')
  return `<!doctype html><html><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"/>
<style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;touch-action:none;-webkit-user-select:none;user-select:none}
body{background:transparent}
#viewport{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;overflow:hidden;touch-action:none}
#stage{transform-origin:center center;will-change:transform}
#stage svg{display:block;max-width:92vw;max-height:78vh;width:auto;height:auto}
</style></head><body>
<div id="viewport"><div id="stage"></div></div>
<script>
const config=${data};
document.body.style.background=config.background;
const stage=document.getElementById('stage');
stage.innerHTML=config.svg;
const MIN=1,MAX=8,DOUBLE=2.5,TAP_MS=300,TAP_SLOP=24;
let scale=1,tx=0,ty=0,mode=null,start=null,lastTap=0,lastX=0,lastY=0;
const dist=(a,b)=>Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY);
const mid=(a,b)=>({x:(a.clientX+b.clientX)/2,y:(a.clientY+b.clientY)/2});
function apply(){stage.style.transform='translate('+tx+'px,'+ty+'px) scale('+scale+')'}
function settle(){scale=Math.min(MAX,Math.max(MIN,scale));if(scale<=MIN){scale=MIN;tx=0;ty=0}apply()}
document.addEventListener('touchstart',event=>{
  if(event.touches.length===2){
    event.preventDefault();
    mode='pinch';
    start={scale,tx,ty,dist:dist(event.touches[0],event.touches[1]),mid:mid(event.touches[0],event.touches[1])};
    return;
  }
  if(event.touches.length===1){
    mode='pan';
    start={scale,tx,ty,x:event.touches[0].clientX,y:event.touches[0].clientY};
  }
},{passive:false});
document.addEventListener('touchmove',event=>{
  if(!start)return;
  if(mode==='pinch'&&event.touches.length===2){
    event.preventDefault();
    const next=Math.min(MAX*1.4,Math.max(MIN*0.7,start.scale*(dist(event.touches[0],event.touches[1])/Math.max(1,start.dist))));
    const ratio=next/start.scale;
    const point=mid(event.touches[0],event.touches[1]);
    scale=next;
    tx=point.x-(start.mid.x-start.tx)*ratio;
    ty=point.y-(start.mid.y-start.ty)*ratio;
    apply();
    return;
  }
  if(mode==='pan'&&event.touches.length===1&&scale>MIN){
    event.preventDefault();
    tx=start.tx+(event.touches[0].clientX-start.x);
    ty=start.ty+(event.touches[0].clientY-start.y);
    apply();
  }
},{passive:false});
document.addEventListener('touchend',event=>{
  if(event.touches.length>0){
    if(event.touches.length===1){
      mode='pan';
      start={scale,tx,ty,x:event.touches[0].clientX,y:event.touches[0].clientY};
    }
    return;
  }
  const tap=event.changedTouches[0];
  const now=Date.now();
  const wasTap=mode==='pan'&&start&&Math.hypot(tap.clientX-start.x,tap.clientY-start.y)<TAP_SLOP;
  mode=null;start=null;
  if(wasTap&&now-lastTap<TAP_MS&&Math.hypot(tap.clientX-lastX,tap.clientY-lastY)<TAP_SLOP){
    lastTap=0;
    if(scale>MIN){scale=MIN;tx=0;ty=0}
    else{
      scale=DOUBLE;
      tx=window.innerWidth/2-tap.clientX;
      ty=window.innerHeight/2-tap.clientY;
    }
    apply();
    return;
  }
  if(wasTap){lastTap=now;lastX=tap.clientX;lastY=tap.clientY}
  settle();
},{passive:false});
</script></body></html>`
}
