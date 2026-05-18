import { useState } from 'react'
import { GitBranch } from 'lucide-react'
import type { SectionDef } from '../components/Section'
import { Btn, Row, Out } from '../components/kit'

function Demo() {
  const [out, setOut] = useState('Read-only git access scoped to the project repo.')

  const info = async () => {
    const i = await window.superone.git.info()
    const dirty = i.dirty ? ` · ${i.dirty.files} changed` : ' · clean'
    setOut(`branch: ${i.branch}${dirty}`)
  }
  const log = async () => {
    const entries = await window.superone.git.log({ limit: 5 })
    setOut(
      entries
        .map((c) => `${c.sha.slice(0, 7)}  ${c.message.split('\n')[0]}`)
        .join('\n'),
    )
  }
  const status = async () => {
    const files = await window.superone.git.status()
    setOut(
      files.length
        ? files.map((f) => `${f.status}  ${f.path}`).join('\n')
        : 'working tree clean',
    )
  }

  return (
    <div>
      <Row>
        <Btn onClick={info}>git.info()</Btn>
        <Btn onClick={log}>git.log()</Btn>
        <Btn onClick={status}>git.status()</Btn>
      </Row>
      <Out>{out}</Out>
    </div>
  )
}

const react = `import { useEffect, useState } from 'react'

function GitHeader() {
  const [branch, setBranch] = useState('')

  useEffect(() => {
    const load = async () => {
      const info = await window.superone.git.info()
      setBranch(info.branch)
    }
    load()
    // Re-fetch on branch switch / commit / rebase
    const unsub = window.superone.git.onHeadChange(load)
    return unsub
  }, [])

  return <span>on {branch}</span>
}`

const vanilla = `// Read-only. Writes (commit/push) go via superone.agent.sendPrompt()
const info = await superone.git.info()      // { branch, dirty? }
const log  = await superone.git.log({ limit: 20 })
const st   = await superone.git.status()    // [{ path, status, staged }]
const diff = await superone.git.diff('src/main.ts')
const blame = await superone.git.blame('src/main.ts')

const unsub = superone.git.onHeadChange(() => {
  // branch switched / new commit — refetch
})`

export const gitSection: SectionDef = {
  id: 'git',
  icon: GitBranch,
  title: 'Git',
  api: 'superone.git',
  blurb:
    'Read-only git: info, log, status, diff, blame, tags, remotes + onHeadChange. Writes go through the agent.',
  Demo,
  react,
  vanilla,
}
