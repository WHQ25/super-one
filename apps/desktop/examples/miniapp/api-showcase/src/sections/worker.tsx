import { useEffect, useRef, useState } from 'react'
import { Cog } from 'lucide-react'
import type { SectionDef } from '../components/Section'
import { Btn, Row, Out } from '../components/kit'

function Demo() {
  const [pct, setPct] = useState(0)
  const [state, setState] = useState('stopped')
  const [log, setLog] = useState('Start a download, then close the panel — it keeps running.')
  const offRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    offRef.current = window.superone.worker.onMessage((raw) => {
      const m = raw as { type: string; percent?: number; path?: string; bytes?: number; error?: string }
      if (m.type === 'ready') setState('running')
      else if (m.type === 'progress') {
        setPct(m.percent ?? 0)
        setLog(`Downloading… ${m.percent}%`)
      } else if (m.type === 'done') {
        setPct(100)
        setState('idle')
        setLog(`Done → ${m.path} (${m.bytes} bytes)`)
        window.superone.ui.toast('Background download finished', 'success')
      } else if (m.type === 'error') setLog('Error: ' + m.error)
    })
    // Re-sync if a worker is already running from a previous panel session.
    window.superone.worker.status().then((s) => {
      if (s.running) {
        setState('running')
        window.superone.worker.postMessage({ type: 'query' })
      }
    })
    return () => offRef.current?.()
  }, [])

  const start = async (src: string, dest: string) => {
    setLog('Starting worker…')
    await window.superone.worker.start()
    setState('running')
    window.superone.worker.postMessage({ type: 'download', src, dest })
  }

  return (
    <div>
      <Row>
        <Btn onClick={() => start('logo.png', 'downloads/logo-copy.png')}>
          Download (local)
        </Btn>
        <Btn
          variant="ghost"
          onClick={() =>
            start(
              'https://cdn.jsdelivr.net/npm/lodash@4.17.21/lodash.min.js',
              'downloads/lodash.min.js',
            )
          }
        >
          Download (CDN)
        </Btn>
        <Btn
          variant="ghost"
          onClick={async () => {
            await window.superone.worker.stop()
            setState('stopped')
          }}
        >
          Stop worker
        </Btn>
      </Row>
      <progress value={pct} max={100} className="w-full mt-3 h-2" />
      <Out>
        state: {state}
        {'\n'}
        {log}
      </Out>
    </div>
  )
}

const react = `import { useEffect, useState } from 'react'

function Downloader() {
  const [pct, setPct] = useState(0)

  useEffect(() => {
    const off = window.superone.worker.onMessage((m) => {
      if (m.type === 'progress') setPct(m.percent)
      if (m.type === 'done') window.superone.ui.toast('Saved ' + m.path, 'success')
    })
    // Re-sync if a worker is already running from a previous session
    window.superone.worker.status().then((s) => {
      if (s.running) window.superone.worker.postMessage({ type: 'query' })
    })
    return off
  }, [])

  const go = async () => {
    await window.superone.worker.start()
    window.superone.worker.postMessage({ type: 'download', src: 'logo.png', dest: 'out.png' })
  }

  return (
    <>
      <button onClick={go}>Start</button>
      <button onClick={() => window.superone.worker.stop()}>Stop</button>
      <progress value={pct} max={100} />
    </>
  )
}`

const vanilla = `// manifest: background.entry + permissions.background
// Panel side — superone.worker.*
await superone.worker.start()
superone.worker.onMessage((m) => {
  if (m.type === 'progress') bar.value = m.percent
  if (m.type === 'done') superone.ui.toast('Saved ' + m.path, 'success')
})
superone.worker.postMessage({ type: 'download', src: url, dest: 'out.bin' })
superone.worker.postMessage({ type: 'query' })   // re-sync on reopen

// Worker side (background.html) — superone.self.*
const lease = superone.self.keepAlive('download')   // block 30s idle reclaim
try {
  /* fetch + superone.fs.writeFile + superone.self.postMessage(...) */
} finally {
  lease.release()
}`

export const workerSection: SectionDef = {
  id: 'worker',
  icon: Cog,
  title: 'Background Worker',
  api: 'superone.worker / self',
  blurb:
    'A headless process that outlives the panel. Always wrap work in keepAlive()…finally release(); emit "ready" + answer "query" so a reopened panel re-syncs.',
  Demo,
  react,
  vanilla,
}
