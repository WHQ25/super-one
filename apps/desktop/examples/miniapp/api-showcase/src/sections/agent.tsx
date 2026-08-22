import { useEffect, useState } from 'react'
import { Bot } from 'lucide-react'
import type { SectionDef } from '../components/Section'
import { Btn, Row, Out } from '../components/kit'
import { callHost } from '../lib/host-rpc'

function Demo() {
  const [out, setOut] = useState(
    'Agent APIs live in the MiniApp Host — the WebView asks through superone.node.',
  )

  useEffect(() => {
    return window.superone.node.onMessage((message) => {
      if ((message as { type?: string })?.type === 'context-consumed') {
        setOut('Context was consumed by a sent message.')
      }
    })
  }, [])

  return (
    <div>
      <Row>
        <Btn
          onClick={async () => {
            await callHost('sendPrompt', {
              text: 'Explain what the SuperOne mini-app bridge is in one sentence.',
            })
            setOut('Prefilled the chat input — the user decides to send.')
          }}
        >
          agent.sendPrompt()
        </Btn>
        <Btn
          variant="ghost"
          onClick={async () => {
            await callHost('setContext', {
              summary: 'showcase selection',
              content: 'Three files:\n- src/App.tsx\n- src/node.ts\n- manifest.json',
              mode: 'inject',
              color: '#c4873a',
            })
            setOut('Attached an inject-mode context chip to the chat input.')
          }}
        >
          agent.setContext()
        </Btn>
        <Btn
          variant="ghost"
          onClick={async () => {
            await callHost('clearContext')
            setOut('Context chip cleared.')
          }}
        >
          agent.clearContext()
        </Btn>
      </Row>
      <Out>{out}</Out>
    </div>
  )
}

const react = `// node.ts — the agent API is Node-side
export function activate(context: SuperOneMiniAppContext) {
  context.subscriptions.push(
    context.agent.onContextConsumed(() => {
      context.webview.postMessage({ type: 'context-consumed' })
    }),
    context.webview.onMessage(async (message) => {
      if (message?.type === 'ask') {
        await context.agent.sendPrompt('Summarize the selected files')
      }
    }),
  )
}

// App.tsx — the WebView only asks
<button onClick={() => window.superone.node.postMessage({ type: 'ask' })}>
  Ask the agent
</button>`

const vanilla = `// node.js
context.agent.sendPrompt('Analyze this data and summarize')

context.agent.setContext({
  summary: '3 files selected',
  content: 'src/a.ts\\nsrc/b.ts\\nsrc/c.ts',
  mode: 'inject',       // or 'suggest' — the user opts in
  color: '#4a7fbf'
})

const sub = context.agent.onContextConsumed(() => {
  // the card went out with a message
})

context.agent.clearContext()`

export const agentSection: SectionDef = {
  id: 'agent',
  icon: Bot,
  title: 'Agent',
  api: 'context.agent',
  blurb:
    'Prefill the chat input and attach context cards. Node-side: a background task can reach the agent with no UI open.',
  Demo,
  react,
  vanilla,
}
