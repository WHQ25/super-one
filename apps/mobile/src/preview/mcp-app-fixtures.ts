import type { ChatMessage } from '@superone/shared/agent-types'
import type { McpAppHostResult, ToolAppAttachment } from '@superone/shared/mcp-apps'
import {
  MCP_MENTION_SEARCH_IDLE, encodeMcpMentionValue, formatMcpResourceReminder, wrapMcpResourceMention,
  type McpMentionReadResource, type McpMentionSearchState, type McpMentionSource,
} from '@superone/shared/mcp-app-mentions'

const PART_TEXT = 'Hex bolt M6 × 30\nGrade 8.8, stainless steel, ISO 4017\nThread pitch 1.0 mm, head 10 mm across flats'

/** A server answering `@` in the preview: one part with text, one the read refuses. */
export const previewMcpMentionSource: McpMentionSource = { server: 'bits', tool: 'search_parts', title: 'Bits CAD', items: [
  { uri: 'cad://parts/hex-bolt', label: 'Hex bolt', detail: 'M6 × 30, stainless' },
  { uri: 'cad://parts/hex-nut', label: 'Hex nut', detail: 'Binary STEP model' },
] }
export const previewMcpMentions: McpMentionSearchState = { ...MCP_MENTION_SEARCH_IDLE, sources: [previewMcpMentionSource] }

/** The host's read of a composer chip, after the half second a warm server takes. */
export function readPreviewMcpMention(value: string): Promise<McpMentionReadResource | null> {
  const resource: McpMentionReadResource = value.endsWith('hex-bolt')
    ? { server: 'bits', uri: 'cad://parts/hex-bolt', text: PART_TEXT }
    : { server: 'bits', uri: 'cad://parts/hex-nut', skipped: 'binary' }
  return new Promise((resolve) => setTimeout(() => resolve(resource), 500))
}

const SENT_MCP_TEXT = `Mark a few places worth visiting in Hangzhou on a map, and size ${wrapMcpResourceMention(encodeMcpMentionValue('bits', 'cad://parts/hex-bolt'), 'Hex bolt')} for the sign posts.`
  + formatMcpResourceReminder([{ server: 'bits', uri: 'cad://parts/hex-bolt', text: PART_TEXT }])

/**
 * A hand-written MCP App View (JSON-RPC over postMessage, no SDK) for the preview's
 * `mcp-app` transcript: enough of the protocol to initialize, paint the tool result and
 * ask for fullscreen, so the phone's inline and fullscreen chrome can be reviewed offline.
 */
const VIEW_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%}
body{font:13px var(--font-sans,system-ui);color:var(--color-text-primary,#111);background:var(--color-background-primary,#fff);display:flex;flex-direction:column}
#map{position:relative;flex:1;min-height:200px;background-color:var(--color-background-secondary,#f3f3f3);background-image:linear-gradient(rgba(127,127,127,.18) 1px,transparent 1px),linear-gradient(90deg,rgba(127,127,127,.18) 1px,transparent 1px);background-size:28px 28px}
.pin{position:absolute;width:12px;height:12px;border-radius:50%;background:#D85A30;border:2px solid #fff}
.tag{position:absolute;transform:translate(-30%,14px);font-size:11px;white-space:nowrap}
#bar{display:flex;gap:6px;align-items:center;padding:8px}
#bar span{flex:1;color:var(--color-text-secondary,#666)}
button{font:inherit;padding:6px 10px;border-radius:8px;border:1px solid rgba(127,127,127,.4);background:transparent;color:inherit}
</style></head><body>
<div id="map"></div>
<div id="bar"><span id="mode">connecting…</span><button id="fullscreen">Fullscreen</button></div>
<script>
let next = 1; const pending = new Map()
const post = (m) => window.parent.postMessage(m, '*')
const request = (method, params) => new Promise((resolve, reject) => { const id = next++; pending.set(id, { resolve, reject }); post({ jsonrpc: '2.0', id, method, params }) })
const notify = (method, params) => post({ jsonrpc: '2.0', method, params })
const showMode = (mode) => { document.getElementById('mode').textContent = mode; document.getElementById('fullscreen').style.display = mode === 'fullscreen' ? 'none' : '' }
function render(result) {
  const places = (result && result.structuredContent && result.structuredContent.places) || []
  document.getElementById('map').innerHTML = places.map((p) => '<div class="pin" style="left:' + p.x + '%;top:' + p.y + '%"></div><div class="tag" style="left:' + p.x + '%;top:' + p.y + '%">' + p.name + '</div>').join('')
}
window.addEventListener('message', (event) => {
  if (event.source !== window.parent) return
  const msg = event.data
  if (!msg || msg.jsonrpc !== '2.0') return
  if ('id' in msg && !('method' in msg)) { const p = pending.get(msg.id); if (!p) return; pending.delete(msg.id); msg.error ? p.reject(msg.error) : p.resolve(msg.result); return }
  if (msg.method === 'ui/notifications/tool-result') render(msg.params)
  else if (msg.method === 'ui/notifications/host-context-changed' && msg.params.displayMode) showMode(msg.params.displayMode)
  else if ('id' in msg) post({ jsonrpc: '2.0', id: msg.id, result: {} })
})
document.getElementById('fullscreen').addEventListener('click', () => request('ui/request-display-mode', { mode: 'fullscreen' }).catch((e) => { document.getElementById('mode').textContent = e.message || 'refused' }))
request('ui/initialize', { protocolVersion: '2026-01-26', appInfo: { name: 'preview-maps', version: '1.0.0' }, appCapabilities: { availableDisplayModes: ['inline', 'fullscreen'] } })
  .then((result) => { showMode((result.hostContext && result.hostContext.displayMode) || 'inline'); notify('ui/notifications/initialized', {}); notify('ui/notifications/size-changed', { height: 300 }) })
</script></body></html>`

const TOOL_RESULT = {
  content: [{ type: 'text', text: 'Marked 3 places in Hangzhou.' }],
  structuredContent: { places: [
    { name: 'West Lake', x: 30, y: 30 },
    { name: 'Lingyin Temple', x: 62, y: 48 },
    { name: 'Xixi Wetland', x: 40, y: 70 },
  ] },
}

const app: ToolAppAttachment = {
  appInstanceId: 'preview-maps',
  binding: { node: 'local', session: 'preview', server: 'maps', configGeneration: 1, configFingerprint: 'preview' },
  harnessCallId: 'preview-maps-call',
  resourceUri: 'ui://maps/places.html',
  resource: { html: VIEW_HTML, hash: 'preview-maps-v1', meta: { csp: { connectDomains: [], resourceDomains: [] } } },
  presentation: { toolTitle: 'Show places', serverTitle: 'Maps' },
  toolInput: { city: 'Hangzhou' },
  toolResult: TOOL_RESULT,
  status: 'result',
}

export const previewMcpAppMessages: ChatMessage[] = [
  { id: 'preview-mcp-user', role: 'user', providerId: 'claude', status: 'complete', createdAt: '',
    content: [{ type: 'text', text: SENT_MCP_TEXT }] },
  { id: 'preview-mcp-assistant', role: 'assistant', providerId: 'claude', status: 'complete', createdAt: '', content: [
    { type: 'tool_use', toolName: 'mcp__maps__show_places', toolUseId: 'preview-maps-call', input: JSON.stringify(app.toolInput), status: 'complete', app },
    { type: 'tool_result', toolUseId: 'preview-maps-call', summary: 'Marked 3 places in Hangzhou.', app },
    { type: 'text', text: 'Marked three places. Open the map full screen to look around.' },
  ] },
]

/** The host's answer to the View's calls: activation succeeds, nothing else is served. */
export function answerPreviewMcpApp(payload: unknown): McpAppHostResult {
  const operation = (payload as { operation?: string } | undefined)?.operation
  if (operation === 'activate') return { ok: true, value: {} }
  return { ok: false, error: { code: 'denied', message: 'The preview serves no MCP server' } }
}
