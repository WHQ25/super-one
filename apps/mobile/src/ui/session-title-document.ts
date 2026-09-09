import {
  sessionTitleAnimationCss, SESSION_TITLE_OUT_MS, SESSION_TITLE_STAGGER_MS,
  SESSION_TITLE_FLIP_MS, SESSION_TITLE_TAIL_MS,
} from '@superone/shared/session-title-animation'

export function sessionTitleDocument(config: {
  from: string; to: string; color: string; primary: string; fontSize: number;
  fontWeight: string; fontFamily: string; letterSpacing: number; textAlign?: 'left' | 'center';
}): string {
  // Titles are data, never markup or executable script.
  const data = JSON.stringify(config).replace(/</g, '\\u003c')
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<style>${sessionTitleAnimationCss}
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}
body{display:flex;align-items:center}
.animated-title-wrap{display:block;min-width:0;max-width:100%;align-self:center}
</style></head><body><span class="animated-title-wrap" data-phase="idle"><span class="animated-title-inner"></span></span>
<script>
const config=${data};
const wrap=document.querySelector('.animated-title-wrap'), inner=wrap.firstElementChild;
Object.assign(wrap.style,{color:config.color,fontSize:config.fontSize+'px',fontWeight:config.fontWeight,fontFamily:config.fontFamily,letterSpacing:config.letterSpacing+'px'});
wrap.style.setProperty('--primary',config.primary);
document.body.style.justifyContent=config.textAlign==='center'?'center':'flex-start';
const post=phase=>window.ReactNativeWebView?.postMessage(JSON.stringify({phase}));
const paint=(title,writing)=>inner.replaceChildren(...Array.from(title,(ch,i)=>{
 const span=document.createElement('span');span.className='animated-title-ch'+(writing?' is-flip':'');span.textContent=ch;
 if(writing)span.style.animationDelay=(i*${SESSION_TITLE_STAGGER_MS})+'ms';return span;
}));
paint(config.from,false);
let started=false;
window.startTitleAnimation=()=>{if(started)return;started=true;requestAnimationFrame(()=>requestAnimationFrame(()=>{
 wrap.dataset.phase='out';
 setTimeout(()=>{paint(config.to,true);wrap.dataset.phase='in';post('in')},${SESSION_TITLE_OUT_MS});
 setTimeout(()=>{wrap.dataset.phase='idle';post('done')},${SESSION_TITLE_OUT_MS}+Math.max(0,config.to.length-1)*${SESSION_TITLE_STAGGER_MS}+${SESSION_TITLE_FLIP_MS}+${SESSION_TITLE_TAIL_MS});
}))};
post('ready');
</script></body></html>`
}
