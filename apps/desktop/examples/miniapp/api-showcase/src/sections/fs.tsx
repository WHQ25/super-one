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
    setOut(`writeFile(${path})\nreadFile → "${back}"\nstat → ${stat.size} bytes`)
    window.superone.ui.toast('File round-trip complete', 'success')
  }

  return (
    <div>
      <Row>
        <Btn onClick={list}>readDir('.')</Btn>
        <Btn onClick={roundTrip}>write → read → stat</Btn>
      </Row>
      <Out>{out}</Out>
    </div>
  )
}

const react = `import { useState } from 'react'

function FileList() {
  const [files, setFiles] = useState<string[]>([])

  async function load() {
    const entries = await window.superone.fs.readDir('.')
    setFiles(entries.map((e) => e.name))
  }

  async function roundTrip() {
    await window.superone.fs.writeFile('note.txt', 'hello')
    const text = await window.superone.fs.readFile('note.txt')
    console.log(text) // "hello"
  }

  return (
    <>
      <button onClick={load}>List</button>
      <ul>{files.map((f) => <li key={f}>{f}</li>)}</ul>
    </>
  )
}`

const vanilla = `// permissions.fs must declare the directory + access level
const entries = await superone.fs.readDir('.')
document.getElementById('list').textContent =
  entries.map((e) => e.name).join(', ')

await superone.fs.writeFile('note.txt', 'hello')
const text = await superone.fs.readFile('note.txt')   // "hello"
const buf = await superone.fs.readFile('logo.png', { binary: true })

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
