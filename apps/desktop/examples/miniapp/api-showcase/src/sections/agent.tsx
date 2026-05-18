import { useEffect, useState } from 'react'
import { Bot } from 'lucide-react'
import type { SectionDef } from '../components/Section'
import { Btn, Row, Out } from '../components/kit'

function Demo() {
  const [out, setOut] = useState(
    'The app can suggest a prompt or attach context — the user stays in control.',
  )

  useEffect(() => {
    const off = window.superone.agent.onContextConsumed(() =>
      setOut('Context was consumed by a sent message.'),
    )
    return off
  }, [])

  return (
    <div>
      <Row>
        <Btn
          onClick={() => {
            window.superone.agent.sendPrompt(
              'Explain what the SuperOne mini-app bridge is in one sentence.',
            )
            setOut('Prefilled the chat input — the user decides to send.')
          }}
        >
          sendPrompt()
        </Btn>
        <Btn
          variant="ghost"
          onClick={() => {
            window.superone.agent.setContext({
              summary: 'showcase selection',
              content: 'Three files:\n- src/App.tsx\n- src/worker.ts\n- manifest.json',
              mode: 'inject',
              color: '#c4873a',
            })
            setOut('Attached an inject-mode context chip to the chat input.')
          }}
        >
          setContext()
        </Btn>
        <Btn
          variant="ghost"
          onClick={() => {
            window.superone.agent.clearContext()
            setOut('Context chip cleared.')
          }}
        >
          clearContext()
        </Btn>
      </Row>
      <Out>{out}</Out>
    </div>
  )
}

const react = `function SearchForm() {
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const q = new FormData(e.currentTarget).get('q')
    // Pre-fills chat input — the user chooses to send it
    window.superone.agent.sendPrompt(\`Search the codebase for: \${q}\`)
  }
  return (
    <form onSubmit={onSubmit}>
      <input name="q" />
    </form>
  )
}`

const vanilla = `// Suggest a prompt (user must press send)
superone.agent.sendPrompt('Analyze this data and summarize')

// Attach a context chip to the chat input
superone.agent.setContext({
  summary: '3 selected tasks',
  content: 'Task 1...\\nTask 2...\\nTask 3...',
  mode: 'inject',            // or 'suggest' (opt-in checkbox)
  color: '#4a7fbf',
})

const unsub = superone.agent.onContextConsumed(() => {
  // re-inject if state is still relevant
})
superone.agent.clearContext()`

export const agentSection: SectionDef = {
  id: 'agent',
  icon: Bot,
  title: 'Agent',
  api: 'superone.agent',
  blurb:
    'Suggest prompts and attach context chips — the app can never silently instruct the agent; the user always confirms.',
  Demo,
  react,
  vanilla,
}
