import { useEffect, useState } from 'react'
import { Hammer } from 'lucide-react'
import type { SectionDef } from '../components/Section'
import { Btn, Row, Out } from '../components/kit'

function Demo() {
  const [messages, setMessages] = useState<string[]>([])

  useEffect(() => {
    // Panel-bound tool: the handler lives in the running React panel.
    window.superone.tools.handle('show_message', (args) => {
      const text = String(args.text ?? '')
      setMessages((m) => [text, ...m].slice(0, 5))
      return { success: true, summary: text.slice(0, 40) }
    })

    // intercept + result tool: the confirm template collects { approved,
    // note }, shallow-merged onto the agent input, then dispatched here.
    window.superone.tools.handle('confirm_action', (args) => {
      const at = new Date().toLocaleTimeString()
      const approved = args.approved === true
      const action = String(args.action ?? '')
      const note = String(args.note ?? '')
      setMessages((m) => [`confirm_action: ${action} (${approved ? 'ok' : 'cancelled'})`, ...m].slice(0, 5))
      return {
        action,
        note,
        approved,
        at,
        summary: `${action} · ${approved ? 'approved' : 'cancelled'}`,
      }
    })
  }, [])

  return (
    <div>
      <Row>
        <Btn
          onClick={() =>
            window.superone.agent.sendPrompt(
              'Call the showcase__show_message tool with text="Hello from the agent 👋".',
            )
          }
        >
          Ask agent → show_message
        </Btn>
        <Btn
          variant="ghost"
          onClick={() =>
            window.superone.agent.sendPrompt(
              'Call the showcase__confirm_action tool with action="Deploy to staging". I will confirm it inline.',
            )
          }
        >
          Ask agent → confirm_action
        </Btn>
        <Btn
          variant="ghost"
          onClick={() =>
            window.superone.agent.sendPrompt(
              'Call the showcase__bump_counter tool with by=3.',
            )
          }
        >
          Ask agent → bump_counter
        </Btn>
      </Row>
      <Out>
        {messages.length
          ? messages.map((m) => `• ${m}`).join('\n')
          : 'Ask the agent to call a tool — handler output appears here.\n\n' +
            'show_message  → panel-bound (this React app)\n' +
            'confirm_action → intercept + result renderer (HITL)\n' +
            'bump_counter  → standalone (runs with panel closed)'}
      </Out>
    </div>
  )
}

const react = `import { useEffect, useState } from 'react'

function ToolHost() {
  const [data, setData] = useState<unknown>(null)

  useEffect(() => {
    // Register once on mount. Return value → MCP tool result.
    window.superone.tools.handle('show_message', (args) => {
      setData(args)
      return { success: true, summary: String(args.text).slice(0, 40) }
    })
  }, [])

  return <pre>{JSON.stringify(data, null, 2)}</pre>
}`

const vanilla = `// manifest.json: { toolSlug: 'showcase', tools: [{ name: 'show_message', ... }] }
// Registered as showcase__show_message with the MCP server.
superone.tools.handle('show_message', (args) => {
  document.getElementById('out').textContent = args.text
  return { success: true, summary: args.text.slice(0, 40) }  // → agent
})

// Modes (see manifest):
//  • panel-bound  — handler in the open panel
//  • renderer.intercept + result — human-in-the-loop confirm + receipt
//  • standalone   — one chat-block iframe is the whole runtime
//    superone.tools.handle('bump_counter', async ({ by }) => {
//      const n = ((await superone.kv.get('c')) ?? 0) + (by ?? 1)
//      await superone.kv.set('c', n)
//      return { value: n }
//    })`

export const toolsSection: SectionDef = {
  id: 'tools',
  icon: Hammer,
  title: 'Agent-Facing Tools',
  api: 'superone.tools',
  blurb:
    'Three tool modes wired in this app: panel-bound (show_message), intercept+result HITL (confirm_action), and standalone (bump_counter).',
  Demo,
  react,
  vanilla,
}
