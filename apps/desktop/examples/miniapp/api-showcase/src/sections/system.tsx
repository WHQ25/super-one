import { useState } from 'react'
import { Wrench } from 'lucide-react'
import type { SectionDef } from '../components/Section'
import { Btn, Row, Out } from '../components/kit'

function Demo() {
  const [out, setOut] = useState('Open folders / links and use the clipboard.')

  return (
    <div>
      <Row>
        <Btn
          onClick={() => {
            window.superone.openFolder('.')
            setOut('Revealing the project folder in the OS file manager…')
          }}
        >
          openFolder('.')
        </Btn>
        <Btn
          variant="ghost"
          onClick={() => {
            window.superone.openExternalLink('https://github.com/WHQ25/super-one')
            setOut('Opening external link (host shows a confirm dialog)…')
          }}
        >
          openExternalLink()
        </Btn>
        <Btn
          variant="ghost"
          onClick={() => {
            window.superone.clipboard.write('Copied from API Showcase ✨')
            setOut('Wrote to clipboard.')
          }}
        >
          clipboard.write()
        </Btn>
        <Btn
          variant="ghost"
          onClick={async () => {
            try {
              const t = await window.superone.clipboard.read()
              setOut('clipboard.read() → ' + t)
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

const react = `function SystemActions() {
  const paste = async () => {
    try {
      const text = await window.superone.clipboard.read() // permission prompt
      console.log(text)
    } catch {
      // user denied clipboard access
    }
  }

  return (
    <>
      <button onClick={() => window.superone.openFolder('.')}>Reveal folder</button>
      <button onClick={() => window.superone.openExternalLink('https://super-one.dev')}>
        Open link
      </button>
      <button onClick={() => window.superone.clipboard.write('Copied ✨')}>Copy</button>
      <button onClick={paste}>Paste</button>
    </>
  )
}`

const vanilla = `superone.openFolder('.')                 // reveal in Finder/Explorer
superone.openFolder('src/utils')

// http/https only; host shows a confirm dialog
superone.openExternalLink('https://docs.example.com')

superone.clipboard.write('Hello, world!')  // shows a toast
try {
  const text = await superone.clipboard.read()  // permission prompt
} catch (err) {
  // "User denied clipboard access"
}`

export const systemSection: SectionDef = {
  id: 'openFolder',
  icon: Wrench,
  title: 'System & Clipboard',
  api: 'superone.openFolder / clipboard',
  blurb:
    'openFolder / openExternalLink (confirmed) / clipboard.write (toast) / clipboard.read (permission prompt).',
  Demo,
  react,
  vanilla,
}
