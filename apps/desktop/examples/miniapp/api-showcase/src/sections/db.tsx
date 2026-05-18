import { useEffect, useState } from 'react'
import { Database } from 'lucide-react'
import type { SectionDef } from '../components/Section'
import { Btn, Row, Out } from '../components/kit'

type Note = { id: number; content: string; created_at: number }

function Demo() {
  const [notes, setNotes] = useState<Note[]>([])
  const [text, setText] = useState('')

  const refresh = async () => {
    const rows = await window.superone.db.query<Note>(
      'SELECT id, content, created_at FROM showcase_notes ORDER BY id DESC LIMIT 8',
    )
    setNotes(rows)
  }

  useEffect(() => {
    window.superone.db
      .exec(
        'CREATE TABLE IF NOT EXISTS showcase_notes (id INTEGER PRIMARY KEY, content TEXT NOT NULL, created_at INTEGER NOT NULL)',
      )
      .then(refresh)
  }, [])

  const add = async () => {
    if (!text.trim()) return
    await window.superone.db.exec(
      'INSERT INTO showcase_notes (content, created_at) VALUES (?, ?)',
      [text.trim(), Date.now()],
    )
    setText('')
    refresh()
  }
  const clear = async () => {
    await window.superone.db.exec('DELETE FROM showcase_notes')
    refresh()
  }

  return (
    <div>
      <Row>
        <input
          className="bg-card border border-border rounded-md px-2.5 py-1.5 text-[13px] text-fg outline-none focus:border-primary flex-1 min-w-[140px]"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="A note…"
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <Btn onClick={add}>INSERT</Btn>
        <Btn variant="ghost" onClick={clear}>
          DELETE all
        </Btn>
      </Row>
      <Out>
        {notes.length
          ? notes.map((n) => `#${n.id}  ${n.content}`).join('\n')
          : '(no rows — private SQLite db, no permission needed)'}
      </Out>
    </div>
  )
}

const react = `import { useEffect, useState } from 'react'

function Notes() {
  const [rows, setRows] = useState([])

  const refresh = async () => {
    setRows(await window.superone.db.query('SELECT * FROM notes ORDER BY id DESC'))
  }

  useEffect(() => {
    window.superone.db
      .exec('CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY, content TEXT NOT NULL, created_at INTEGER NOT NULL)')
      .then(refresh)
  }, [])

  const add = async (content) => {
    // Always bind params — never concatenate user input
    await window.superone.db.exec(
      'INSERT INTO notes (content, created_at) VALUES (?, ?)',
      [content, Date.now()],
    )
    refresh()
  }
  const clear = async () => {
    await window.superone.db.exec('DELETE FROM notes')
    refresh()
  }

  return <ul>{rows.map((r) => <li key={r.id}>{r.content}</li>)}</ul>
}`

const vanilla = `// Per-app private SQLite — no permission declaration needed
await superone.db.exec(\`
  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL)\`)

// Always bind params — never concatenate user input
const { lastInsertRowid } = await superone.db.exec(
  'INSERT INTO notes (content, created_at) VALUES (?, ?)',
  ['hello', Date.now()],
)
const rows = await superone.db.query(
  'SELECT * FROM notes ORDER BY id DESC LIMIT 20',
)

// Atomic multi-write (db.transaction(fn) is unavailable — use batch)
await superone.db.batch([
  { sql: 'UPDATE inv SET stock = stock - ? WHERE id = ?', params: [1, 7] },
  { sql: 'INSERT INTO orders (item) VALUES (?)', params: [7] },
])`

export const dbSection: SectionDef = {
  id: 'db',
  icon: Database,
  title: 'SQLite DB',
  api: 'superone.db',
  blurb:
    "Each app gets a private SQLite file (no permission needed). query / exec / batch / pragma. db.transaction(fn) isn't available — use batch().",
  Demo,
  react,
  vanilla,
}
