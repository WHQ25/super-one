import { useEffect, useMemo, useRef, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ComposerViewPorts, ComposerViewRequest } from '@superone/shared/composer-view-bridge'
import type { SuperOneComposerOutcome } from '@superone/shared/composer-api'
import { admitInputRequestSpec, inputRequestMessageText, inputRequestMeta } from '@superone/shared/input-request'
import { InputRequestForm } from './InputRequestPrompt'
import { WidgetBlock } from './WidgetBlock'

type Form = { request: ComposerViewRequest; resolve: (outcome: SuperOneComposerOutcome) => void }

/** Actual iframe SDK and form body, with a host port that has no external side effects. */
function ComposerBridgeDemo({ output = 'caller', denied = false, width = 680 }: {
  output?: 'caller' | 'agent'; denied?: boolean; width?: number
}) {
  const [form, setForm] = useState<Form | null>(null), active = useRef<Form | null>(null)
  const [agentMessage, setAgentMessage] = useState('')
  const [receipt, setReceipt] = useState<unknown>(null)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const accept = (event: MessageEvent) => {
      if (event.source === root.current?.querySelector('iframe')?.contentWindow && event.data?.type === 'story-composer-outcome') setReceipt(event.data.result)
    }
    window.addEventListener('message', accept)
    return () => window.removeEventListener('message', accept)
  }, [])
  const ports = useMemo<ComposerViewPorts>(() => ({
    open: request => {
      if (denied) return Promise.reject(new Error('This widget is no longer available in the session.'))
      if (active.current) return Promise.reject(new Error('This widget already has an open form.'))
      return new Promise(resolve => { const next = { request, resolve }; active.current = next; setForm(next) })
    },
    release: viewId => {
      if (active.current?.request.viewId !== viewId) return
      active.current.resolve({ status: 'cancelled', reason: 'owner_disposed' })
      active.current = null; setForm(null)
    },
  }), [denied])
  const code = `<div style="padding:12px;color:var(--color-text-primary)">
    <button id="open">Open review form</button>
    <pre id="result" style="white-space:pre-wrap;word-break:break-word;margin:12px 0 0;color:var(--color-text-secondary)">Ready</pre>
    </div><script>
    document.getElementById('open').onclick = async function () {
      this.disabled = true;
      try {
        const result = await window.superone.composer.open({
          title: 'Review notes', submitLabel: 'Apply',
          requestedSchema: { type: 'object', required: ['notes'], properties: { notes: { type: 'string', title: 'Notes' } } }
        }, { output: '${output}' });
        document.getElementById('result').textContent = JSON.stringify(result, null, 2);
        parent.postMessage({ type: 'story-composer-outcome', result }, '*');
      } catch (error) {
        document.getElementById('result').textContent = error.message;
        parent.postMessage({ type: 'story-composer-outcome', result: { error: error.message } }, '*');
      }
      finally { this.disabled = false; }
    };
    document.addEventListener('DOMContentLoaded', () => document.getElementById('open').click(), { once: true });
    </script>`
  const admitted = form && admitInputRequestSpec(form.request.spec, { userResources: true })
  const finish = (outcome: SuperOneComposerOutcome) => {
    active.current?.resolve(outcome); active.current = null; setForm(null)
  }
  return (
    <div ref={root} className="space-y-3" style={{ width, maxWidth: '100%' }}>
      <WidgetBlock data={{ title: 'Composer bridge', widget_code: code, width, height: 110, isSVG: false }} composerPorts={ports} />
      {form && admitted?.ok && <div data-chat-root className="rounded-xl border border-border bg-card">
        <InputRequestForm meta={inputRequestMeta(admitted.spec, { kind: 'widget', messageId: 'story-widget' }, form.request.output)} form={admitted.form}
          onSubmit={async values => {
            if (form.request.output === 'agent') setAgentMessage(inputRequestMessageText(admitted.spec, admitted.form, values))
            finish(form.request.output === 'agent' ? { status: 'submitted' } : { status: 'submitted', values })
            return true
          }}
          onCancel={async () => { finish({ status: 'cancelled', reason: 'user' }); return true }} />
      </div>}
      {agentMessage && <pre data-testid="agent-message" className="whitespace-pre-wrap rounded-lg border border-border p-3 text-xs">{agentMessage}</pre>}
      {receipt !== null && <pre data-testid="composer-outcome" className="whitespace-pre-wrap rounded-lg border border-border p-3 text-xs">{JSON.stringify(receipt, null, 2)}</pre>}
    </div>
  )
}

const config = { title: 'Chat/ComposerBridge', component: ComposerBridgeDemo, parameters: { layout: 'padded' } } satisfies Meta<typeof ComposerBridgeDemo>
export default config
type Story = StoryObj<typeof config>
export const CallerRoundTrip: Story = {}
export const AgentRoundTrip: Story = { args: { output: 'agent' } }
export const AdmissionDenied: Story = { args: { denied: true } }
export const NarrowDarkChinese: Story = { args: { width: 300 }, globals: { theme: 'dark', locale: 'zh' } }
