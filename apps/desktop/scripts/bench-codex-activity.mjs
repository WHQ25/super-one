import WebSocket from 'ws'
import { writeFileSync } from 'node:fs'

// Open the same long Codex turn in an isolated dev profile before each run.
// Compare with/without LONG_TURN_PARTS in the desktop CodexTurnView adapter.
const args = process.argv.slice(2)
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] ?? fallback : fallback
const port = option('--port', '9337')
const url = option('--page-url', 'http://localhost:5177/')
const output = option('--output', '/tmp/codex-activity-performance.json')
const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json())
const target = targets.find(page => page.type === 'page' && page.url.startsWith(url))
if (!target) throw new Error(`No development renderer at ${url}`)
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject) })
let sequence = 0
const pending = new Map()
ws.on('message', raw => {
  const message = JSON.parse(raw)
  const request = pending.get(message.id)
  if (!request) return
  pending.delete(message.id)
  clearTimeout(request.timeout)
  if (message.error) request.reject(new Error(JSON.stringify(message.error)))
  else request.resolve(message.result)
})
function send(method, params = {}) {
  const id = ++sequence
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)) }, 30_000)
    pending.set(id, { resolve, reject, timeout })
    ws.send(JSON.stringify({ id, method, params }))
  })
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
  return result.result.value
}
const setup = `const {useActivityPanelStore:panel}=await import('/src/stores/activity-panel.ts');
  const button=()=>document.querySelector('.turn-detail-section button');
  const expanded=()=>button()?.getAttribute('aria-expanded')==='true';
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));`
const setDetail = async open => evaluate(`(async()=>{${setup}if(expanded()!==${open})button().click();await wait(500)})()`)
const setPanel = async open => evaluate(`(async()=>{${setup}panel.getState().setShowPanel(${open});await wait(500)})()`)
let initial
try {
  initial = await evaluate(`(async()=>{${setup}if(!button())throw new Error('Open a long Codex turn with a Detail button first');return{detail:expanded(),panel:panel.getState().showPanel,viewport:{width:innerWidth,height:innerHeight}}})()`)
  await send('Page.bringToFront')
  await send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await send('Performance.enable')
  await setPanel(false)
  const results = []
  for (const operation of ['detail', 'panel']) {
    await setDetail(operation === 'panel')
    const runs = []
    for (let index = 0; index < 3; index++) {
      const before = await send('Performance.getMetrics')
      const frames = await evaluate(`(async()=>{${setup}
        const intervals=[];let previous=performance.now();let raf;
        const tick=()=>{const now=performance.now();intervals.push(now-previous);previous=now;raf=requestAnimationFrame(tick)};
        raf=requestAnimationFrame(tick);
        ${operation === 'detail' ? 'button().click()' : 'panel.getState().setShowPanel(true)'};
        await wait(${operation === 'detail' ? 1500 : 800});
        // Include the initial click-to-render stall, even when it blocks the
        // first frame past the timer deadline. Empty samples are never success.
        await new Promise(requestAnimationFrame);cancelAnimationFrame(raf);
        return{maxFrameMs:Math.max(...intervals),frameSamples:intervals.length,
          framesOver32ms:intervals.filter(ms=>ms>32).length,
          chatDomNodes:document.querySelector('[data-chat-root]').querySelectorAll('*').length,
          mountedTools:document.querySelectorAll('.tool-node').length}
      })()`)
      if (!frames.frameSamples || !Number.isFinite(frames.maxFrameMs)) throw new Error('No animation frame samples')
      const after = await send('Performance.getMetrics')
      const metric = name => 1000 * ((after.metrics.find(value => value.name === name)?.value ?? 0) - (before.metrics.find(value => value.name === name)?.value ?? 0))
      runs.push({ ...frames, layoutMs: metric('LayoutDuration'), styleMs: metric('RecalcStyleDuration'), scriptMs: metric('ScriptDuration'), taskMs: metric('TaskDuration') })
      if (operation === 'detail') await setDetail(false)
      else await setPanel(false)
    }
    const median = name => runs.map(run => run[name]).sort((a, b) => a - b)[1]
    const summary = Object.fromEntries(Object.keys(runs[0]).map(name => [name, median(name)]))
    results.push({ operation, summary, runs })
    console.log(JSON.stringify({ operation, ...summary }))
  }
  writeFileSync(output, JSON.stringify({ environment: 'Electron development renderer; existing user instrumentation unchanged', viewport: initial.viewport, repetitions: 3, method: 'Median of three opens; panel measured with Detail expanded; frame intervals include initial click-to-render stall', results }, null, 2) + '\n')
  console.log(`Saved ${output}`)
} finally {
  try {
    if (initial) { await setDetail(initial.detail); await setPanel(initial.panel) }
    await send('Emulation.setFocusEmulationEnabled', { enabled: false })
  } finally { ws.close() }
}
