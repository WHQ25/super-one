/** Separate WebView. Terminal frames never enter the event ACK path. */

export const TERMINAL_VIEW_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
html,body,#term{margin:0;height:100%;background:#0a0a0a;color:#e4e4e7;font:13px/1.4 ui-monospace,Menlo,monospace}
#meta{font:11px/1.3 system-ui,sans-serif;color:#71717a;padding:6px 12px;border-bottom:1px solid #27272a}
#term{padding:12px;white-space:pre-wrap;overflow:auto;height:calc(100% - 28px)}
.err{color:#fb7185}
</style>
</head>
<body>
<div id="meta">terminal</div>
<div id="term"></div>
<script>
var el=document.getElementById('term');
var meta=document.getElementById('meta');
function append(t){el.textContent+=t;el.scrollTop=el.scrollHeight;}
function replace(t){el.textContent=t;el.scrollTop=el.scrollHeight;}
function setMeta(s){
  var parts=[];
  if(s.title) parts.push(s.title);
  if(s.cwd) parts.push(s.cwd);
  if(s.status) parts.push(s.status);
  if(s.writableByMe===false) parts.push('read-only');
  meta.textContent=parts.join(' · ')||'terminal';
}
window.__applyHost=function(msg){
  if(!msg||typeof msg!=='object') return;
  if(msg.type==='reset'){el.textContent='';return;}
  var p=msg.payload||msg;
  if(p.kind==='replace'||p.type==='replace'){ replace(p.ansi||p.data||''); if(p.snapshot) setMeta(p.snapshot); return; }
  if(p.kind==='append'||p.type==='append'||p.type==='terminal_data'||p.data) append(p.data||p.chunk||'');
  if(p.kind==='meta'||p.snapshot) setMeta(p.snapshot||p);
  if(p.kind==='exited'||p.type==='terminal_exited') append('\\n[exited '+(p.exitCode??'?')+']\\n');
  if(p.kind==='error'||p.type==='terminal_error') append('\\n[error '+(p.code||'')+' '+(p.message||'')+']\\n');
};
document.addEventListener('message',function(e){try{window.__applyHost(JSON.parse(e.data));}catch(err){}});
window.addEventListener('message',function(e){
  var d=e.data; if(typeof d==='string'){try{d=JSON.parse(d);}catch(err){return;}}
  window.__applyHost(d);
});
</script>
</body>
</html>`
