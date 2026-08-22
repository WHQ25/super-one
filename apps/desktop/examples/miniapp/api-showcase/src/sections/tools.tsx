import { useEffect, useState } from 'react'
import { Hammer } from 'lucide-react'
import type { SectionDef } from '../components/Section'
import { Btn, Row, Out } from '../components/kit'
import { callHost } from '../lib/host-rpc'

function Demo() {
  const [messages, setMessages] = useState<string[]>([])

  useEffect(() => {
    return window.superone.node.onMessage((message) => {
      const value = message as { type?: string; text?: string }
      if (value?.type === 'tool-log') setMessages((items) => [String(value.text ?? ''), ...items].slice(0, 5))
    })
  }, [])

  return (
    <div>
      <Row>
        <Btn
          onClick={() =>
            void callHost('sendPrompt', {
              text: 'Call the showcase__show_message tool with text="Hello from the agent 👋".',
            })
          }
        >
          Ask agent → show_message
        </Btn>
        <Btn
          variant="ghost"
          onClick={() =>
            void callHost('sendPrompt', {
              text: 'Call the showcase__confirm_action tool with action="Deploy to staging". I will confirm it inline.',
            })
          }
        >
          Ask agent → confirm_action
        </Btn>
        <Btn
          variant="ghost"
          onClick={() =>
            void callHost('sendPrompt', {
              text: 'Call the showcase__bump_counter tool with by=3.',
            })
          }
        >
          Ask agent → bump_counter
        </Btn>
      </Row>
      <Out>
        {messages.length
          ? messages.map((m) => `• ${m}`).join('\n')
          : 'Ask the agent to call a tool — handler output appears here.\n\n' +
            'show_message  → Node MiniApp Host + WebView event\n' +
            'confirm_action → intercept + result renderer (HITL)\n' +
            'bump_counter  → standalone (runs with panel closed)'}
      </Out>
    </div>
  )
}

const react = `// extension.ts — computation
export function activate(context) {
  context.subscriptions.push(context.tools.handle('show_message', (args) => {
    context.webview.postMessage({ type: 'tool-log', text: args.text })
    return { success: true, summary: String(args.text).slice(0, 40) }
  }))
}

// React WebView — presentation
import { useEffect, useState } from 'react'

function ToolHost() {
  const [log, setLog] = useState([])

  useEffect(() => {
    return window.superone.node.onMessage((message) => {
      if (message.type === 'tool-log') setLog((l) => [message.text, ...l])
    })
  }, [])

  return (
    <>
      <button
        onClick={() =>
          void callHost('sendPrompt', { text: 'Call showcase__show_message with text=hi' })
        }
      >
        Ask agent
      </button>
      <pre>{log.join('\\n')}</pre>
    </>
  )
}`

const vanilla = `// node.js — registered as showcase__show_message
export function activate(context) {
  context.tools.handle('show_message', (args) => {
    context.webview.postMessage({ type: 'tool-log', text: args.text })
    return { success: true, summary: args.text.slice(0, 40) }
  })
}

// index.html — receives UI state from the MiniApp Host
superone.node.onMessage((message) => {
  if (message.type === 'tool-log') out.textContent = message.text
})

// Modes (see manifest):
//  • regular      — handler in the Node MiniApp Host
//  • renderer.intercept + result — human-in-the-loop confirm + receipt
//  • standalone   — result WebView works while the panel is closed`

export const toolsSection: SectionDef = {
  id: 'tools',
  icon: Hammer,
  title: 'Agent-Facing Tools',
  api: 'MiniApp Host context.tools',
  blurb:
    'All computation runs in the Node MiniApp Host; WebViews only present state and collect HITL input.',
  Demo,
  react,
  vanilla,
}
