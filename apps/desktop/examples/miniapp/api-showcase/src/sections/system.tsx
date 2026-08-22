import { useState } from 'react'
import { Wrench } from 'lucide-react'
import type { SectionDef } from '../components/Section'
import { Btn, Row, Out } from '../components/kit'
import { callHost } from '../lib/host-rpc'

function Demo() {
  const [out, setOut] = useState('Reveal folders, open links, use the clipboard — all Node-side.')

  return (
    <div>
      <Row>
        <Btn
          onClick={async () => {
            await callHost('reveal')
            setOut('Revealing the project folder in the OS file manager…')
          }}
        >
          host.revealInFolder()
        </Btn>
        <Btn
          variant="ghost"
          onClick={async () => {
            await callHost('openLink', { url: 'https://github.com/WHQ25/super-one' })
            setOut('Opening external link (host shows a confirm dialog)…')
          }}
        >
          host.openExternal()
        </Btn>
        <Btn
          variant="ghost"
          onClick={async () => {
            await callHost('copy', { text: 'Copied from API Showcase ✨' })
            setOut('Wrote to clipboard.')
          }}
        >
          clipboard.write()
        </Btn>
        <Btn
          variant="ghost"
          onClick={async () => {
            try {
              setOut('clipboard.read() → ' + (await callHost<string>('paste')))
            } catch (e) {
              setOut('Denied: ' + (e as Error).message)
            }
          }}
        >
          clipboard.read()
        </Btn>
      </Row>
      <Out>{out}</Out>
    </div>
  )
}

const react = `// node.ts — host capabilities are Node-side
context.webview.onMessage(async (message) => {
  if (message?.type === 'reveal') {
    await context.host.revealInFolder(context.workspace.rootPath)
  }
  if (message?.type === 'paste') {
    try {
      const text = await context.host.clipboard.read()  // permission prompt
      context.webview.postMessage({ type: 'clipboard', text })
    } catch {
      // the user denied clipboard access
    }
  }
})

// App.tsx
<button onClick={() => window.superone.node.postMessage({ type: 'reveal' })}>
  Reveal folder
</button>`

const vanilla = `// node.js
await context.host.revealInFolder(context.workspace.rootPath)

// http/https only; the host shows a confirm dialog
await context.host.openExternal('https://docs.example.com')

await context.host.clipboard.write('Hello, world!')
try {
  const text = await context.host.clipboard.read()  // permission prompt
} catch (err) {
  // "Clipboard read denied by user"
}

await context.host.toast('Sync finished', 'success')  // works with no UI open`

export const systemSection: SectionDef = {
  id: 'system',
  icon: Wrench,
  title: 'System & Clipboard',
  api: 'context.host',
  blurb:
    'revealInFolder / openExternal (confirmed) / clipboard (permission prompt) / toast — none of them need a mounted WebView.',
  Demo,
  react,
  vanilla,
}
