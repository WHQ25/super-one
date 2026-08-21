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
.tool{color:#a78bfa;font-size:13px;margin:6px 0}
.think{color:#a1a1aa;font-size:13px}
.res{color:#d4d4d8;font-size:13px;opacity:.85}
.err{color:#fb7185}
.stream{border-left:2px solid hsl(var(--brand-hue,250) 60% 55%)}
.empty{color:#71717a}
article{margin:0 0 16px;padding-left:8px}
pre{white-space:pre-wrap;font:inherit;margin:4px 0 0}
pre.code,code{font:13px/1.4 ui-monospace,Menlo,monospace;background:#1c1c1f}
pre.code{padding:8px;border-radius:6px}
.img{max-width:100%;border-radius:8px;margin-top:8px}
.todos{margin:0 0 16px;padding:8px 8px 8px 24px;background:#1c1c1f;border-radius:8px;color:#d4d4d8;font-size:13px}
.chip{display:inline-block;font-size:11px;color:#a1a1aa;border:1px solid #3f3f46;border-radius:999px;padding:1px 8px;margin-left:6px}
a{color:#a78bfa}
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
function esc(s){return String(s).replace(/[&<>"']/g,function(c){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]);});}
function md(src){
  var s=esc(src);
  s=s.replace(/\`\`\`([\\s\\S]*?)\`\`\`/g,'<pre class="code">$1</pre>');
  s=s.replace(/\`([^\`]+)\`/g,'<code>$1</code>');
  s=s.replace(/\\*\\*([^*]+)\\*\\*/g,'<strong>$1</strong>');
  s=s.replace(/\\[([^\\]]+)\\]\\((https?:[^)\\s]+)\\)/g,'<a href="$2">$1</a>');
  return s.replace(/\\n/g,'<br/>');
}
function todosHtml(todos){
  var rows=Array.isArray(todos)?todos:Object.keys(todos||{}).map(function(k){return todos[k];});
  if(!rows.length) return '';
  return '<ul class="todos">'+rows.map(function(t){
    var label=esc(String(t.content||t.text||t.id||''));
    var st=String(t.status||'');
    var mark=st==='completed'?'✓':st==='in_progress'?'▶':'○';
    return '<li>'+mark+' '+label+'</li>';
  }).join('')+'</ul>';
}
function blockHtml(b){
  if(b.type==='text') return '<div>'+md(b.text||'')+'</div>';
  if(b.type==='thinking' && b.thinking) return '<pre class="think">… '+esc(String(b.thinking).slice(0,400))+'</pre>';
  if(b.type==='tool_use'){
    var st=b.status||'';
    return '<div class="tool">⚙ '+esc(b.toolName||'tool')+(st?' · '+esc(st):'')+'</div>';
  }
  if(b.type==='tool_result'){
    var body=b.summary||b.content||'';
    if(typeof body!=='string') body=JSON.stringify(body);
    return '<pre class="res">'+esc(String(body).slice(0,500))+'</pre>';
  }
  if(b.type==='image'||b.type==='image_url'){
    var src=b.url||b.src||'';
    if(!src && b.base64) src='data:'+(b.mimeType||'image/png')+';base64,'+b.base64;
    if(src) return '<img class="img" src="'+esc(src)+'"/>';
    return '<div class="tool">🖼 image</div>';
  }
  return '';
}
var lastTodos='';
function render(messages, todos){
  var root=document.getElementById('root');
  window.__messages=messages;
  var head=todosHtml(todos);
  lastTodos=head;
  if(!messages||!messages.length){root.innerHTML=head||'<p class="empty">Waiting for session…</p>';return;}
  root.innerHTML=head+messages.map(function(m){
    var badge=m.status==='error'?'err':(m.status==='streaming'?'stream':'');
    var err=m.metadata&&m.metadata.errorInfo?('<div class="err">'+(esc(m.metadata.errorInfo.raw||m.metadata.errorInfo.message||'error'))+'</div>'):'';
    var extra='';
    if(m.metadata&&m.metadata.modelFallback) extra+='<span class="chip">fallback</span>';
    if(m.metadata&&m.metadata.sandbox) extra+='<span class="chip">sandbox</span>';
    var body=(m.content||[]).map(blockHtml).join('');
    return '<article class="'+badge+'"><div class="role">'+esc(m.role||'')+(m.status==='streaming'?' · live':'')+extra+'</div>'+err+body+'</article>';
  }).join('');
}
window.__applyHost=function(msg){
  if(!msg||typeof msg!=='object') return;
  if(msg.type==='hydrate'||msg.type==='applyReductionPatch'){
    render(msg.messages, msg.todos);
  }
  if(msg.type==='todos') render(window.__messages, msg.todos);
  if(msg.type==='reset') render([], null);
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
