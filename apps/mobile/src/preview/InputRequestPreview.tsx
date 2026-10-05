import { useRef } from 'react'
import { InputRequestComposer } from '../prompts/InputRequestComposer'
import type { NativeScenario } from './scenarios'

/** Offline fixtures exercise the production slot, including failure and duplicate-click guards. */
export function InputRequestPreview({ scenario, onAction }: {
  scenario: Extract<NativeScenario, { category: 'Input forms' }>
  onAction: (action: string, payload: unknown) => void
}) {
  const attempts = useRef(0)
  return <InputRequestComposer request={scenario.request} connected={scenario.behavior !== 'offline'}
    onSubmit={async values => {
      if (scenario.behavior === 'pending') await new Promise<void>(() => {})
      if (scenario.behavior === 'retry' && attempts.current++ === 0) throw new Error('Preview submission failed. Try again.')
      onAction('submit', { id: scenario.request.requestId, values })
    }}
    onCancel={async () => onAction('cancel', { id: scenario.request.requestId })}
    onPickFiles={async field => {
      if (scenario.behavior === 'upload-failed') throw new Error('Preview upload failed. Try again.')
      return [{ uri: `file:///preview/${field}/reference.stl`, name: 'reference.stl', mimeType: 'model/stl', size: 2048 }]
    }} />
}
