import { useState } from 'react'
import { FolderTree } from 'lucide-react'
import type { SectionDef } from '../components/Section'
import { Btn, Row, Out } from '../components/kit'

function Demo() {
  const [out, setOut] = useState('Click an action to call superone.fs.*')

  const list = async () => {
    const entries = await window.superone.fs.readDir('.')
    setOut(entries.map((e) => (e.isDir ? `📁 ${e.name}` : `📄 ${e.name}`)).join('\n'))
  }
  const roundTrip = async () => {
    const path = 'showcase-fs-demo.txt'
    const stamp = `written at ${new Date().toISOString()}`
    await window.superone.fs.writeFile(path, stamp)
    const back = await window.superone.fs.readFile(path)
    const stat = await window.superone.fs.stat(path)
    setOut(`writeFile(${path})  → project root\nreadFile → "${back}"\nstat → ${stat.size} bytes`)
    window.superone.ui.toast('File round-trip complete', 'success')
  }
  const appData = async () => {
    const path = '@app/showcase-state.json'
    const state = { lastOpened: new Date().toISOString() }
    await window.superone.fs.writeFile(path, JSON.stringify(state))
    const back = await window.superone.fs.readFile(path)
    setOut(`writeFile(${path})  → app data dir\nreadFile → ${back}`)
    window.superone.ui.toast('App-data round-trip complete', 'success')
  }

  return (
    <div>
      <Row>
        <Btn onClick={list}>readDir('.')</Btn>
        <Btn onClick={roundTrip}>write → read → stat</Btn>
        <Btn onClick={appData}>@app data round-trip</Btn>
      </Row>
      <Out>{out}</Out>
    </div>
  )
}

const react = `import { useState } from 'react'

function FileDemo() {
  const [out, setOut] = useState('')

  const list = async () => {
    const entries = await window.superone.fs.readDir('.')
    setOut(entries.map((e) => (e.isDir ? '📁 ' : '📄 ') + e.name).join('\\n'))
  }

  const roundTrip = async () => {
    await window.superone.fs.writeFile('note.txt', 'hello')
    const text = await window.superone.fs.readFile('note.txt')
    const stat = await window.superone.fs.stat('note.txt')
    setOut(text + ' · ' + stat.size + ' bytes')
    window.superone.ui.toast('File round-trip complete', 'success')
  }

  return (
    <>
      <button onClick={list}>List</button>
      <button onClick={roundTrip}>Write → read → stat</button>
      <pre>{out}</pre>
    </>
  )
}`

const vanilla = `// permissions.fs must declare the directory + access level
const entries = await superone.fs.readDir('.')
document.getElementById('list').textContent =
  entries.map((e) => e.name).join(', ')

await superone.fs.writeFile('note.txt', 'hello')      // bare path → project root
const text = await superone.fs.readFile('note.txt')   // "hello"
const buf = await superone.fs.readFile('logo.png', { binary: true })

// Address a non-project scope explicitly with an @scope/ prefix
await superone.fs.writeFile('@app/state.json', '{}')  // → app data dir
await superone.fs.readFile('@user/.config/app/prefs')  // → home root

// Watch for changes (recursive); unwatch on close
const id = await superone.fs.watch('src', (ev) => {
  console.log(ev.type, ev.path)   // 'change' | 'rename'
})
// superone.fs.unwatch(id)`

export const fsSection: SectionDef = {
  id: 'fs',
  icon: FolderTree,
  title: 'File System',
  api: 'superone.fs',
  blurb:
    'Read, write, list, stat, glob and watch files within the directories declared in permissions.fs.',
  Demo,
  react,
  vanilla,
}
