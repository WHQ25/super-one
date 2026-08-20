/** Self-contained WebView document. Host injects via window.__applyHost(msg). */

export const CHAT_VIEW_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"/>
<style>
:root { --brand-hue: 250; color-scheme: dark; }
html,body{margin:0;background:#111;color:#f4f4f5;font:16px/1.45 system-ui,sans-serif}
#root{padding:16px 16px 48px}
.role{font-size:12px;color:#a1a1aa}
.tool{color:#a78bfa}
.err{color:#fb7185}
.empty{color:#71717a}
article{margin:0 0 16px}
pre{white-space:pre-wrap;font:inherit;margin:4px 0 0}
</style>
</head>
<body>
<div id="root"><p class="empty">Waiting for session…</p></div>
<script>
function post(msg){
  var s=JSON.stringify(msg);
  if(window.ReactNativeWebView) window.ReactNativeWebView.postMessage(s);
  else if(window.parent) window.parent.postMessage(msg,'*');
}
function textOf(m){
  return (m.content||[]).map(function(b){
    if(b.type==='text') return b.text||'';
    if(b.type==='tool_use') return '⚙ '+(b.toolName||'tool');
    if(b.type==='thinking' && b.thinking) return '… '+String(b.thinking).slice(0,120);
    return '';
  }).filter(Boolean).join('\\n');
}
function render(messages){
  var root=document.getElementById('root');
  if(!messages||!messages.length){root.innerHTML='<p class="empty">Waiting for session…</p>';return;}
  root.innerHTML=messages.map(function(m){
    var cls=m.status==='error'?'err':'';
    return '<article><div class="role">'+esc(m.role||'')+'</div><pre class="'+cls+'">'+esc(textOf(m))+'</pre></article>';
  }).join('');
}
function esc(s){return String(s).replace(/[&<>]/g,function(c){return ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]);});}
window.__applyHost=function(msg){
  if(!msg||typeof msg!=='object') return;
  if(msg.type==='hydrate'||msg.type==='applyReductionPatch'){
    if(msg.messages) render(msg.messages);
  }
  if(msg.type==='reset') render([]);
  if(msg.type==='setTheme'&&typeof msg.hue==='number'){
    document.documentElement.style.setProperty('--brand-hue',String(msg.hue));
  }
};
document.addEventListener('message',function(e){try{window.__applyHost(JSON.parse(e.data));}catch(err){}});
window.addEventListener('message',function(e){
  var d=e.data; if(typeof d==='string'){try{d=JSON.parse(d);}catch(err){return;}}
  window.__applyHost(d);
});
post({type:'ready'});
</script>
</body>
</html>`
