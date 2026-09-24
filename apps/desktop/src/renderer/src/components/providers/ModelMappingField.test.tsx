/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProviderModelEnv } from '@superone/shared/agent-types'
import type { EndpointModel } from '@superone/shared/platform-registry'
import { ModelMappingField } from './ModelMappingField'

const MODELS: EndpointModel[] = [
  { id: 'mimo-v2.6-pro', name: 'MiMo V2.6 Pro' },
  { id: 'mimo-v2.5-pro', name: 'MiMo V2.5 Pro' },
]

function renderField(models: EndpointModel[], value: ProviderModelEnv, onChange = vi.fn()) {
  const view = render(
    <ModelMappingField label="Model Mapping" models={models} oneMillionIds={new Set()} value={value} onChange={onChange} />,
  )
  return { ...view, onChange }
}

const idInputs = () => screen.queryAllByPlaceholderText('Model ID')
const checkedMode = () => screen.getAllByRole('tab').find((r) => r.getAttribute('aria-selected') === 'true')?.textContent

afterEach(cleanup)

describe('ModelMappingField', () => {
  it('opens on the list when every mapped id is on it', () => {
    renderField(MODELS, { opus: { id: 'mimo-v2.6-pro[1m]', name: 'MiMo V2.6 Pro' } })
    expect(checkedMode()).toBe('Select')
    expect(idInputs()).toHaveLength(0)
  })

  it('opens in manual mode when a mapped id is not on the list', () => {
    renderField(MODELS, { opus: { id: 'mimo-v2.7-pro' } })
    expect(checkedMode()).toBe('Manual')
    expect(idInputs()[1]).toHaveProperty('value', 'mimo-v2.7-pro')
  })

  it('is manual only when there is no list to pick from', () => {
    renderField([], {})
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(idInputs().length).toBeGreaterThan(0)
  })

  it('settles on the list once the catalog arrives after the first render', () => {
    const value = { opus: { id: 'mimo-v2.6-pro' } }
    const { rerender } = renderField([], value)
    rerender(<ModelMappingField label="Model Mapping" models={MODELS} oneMillionIds={new Set()} value={value} onChange={vi.fn()} />)
    expect(checkedMode()).toBe('Select')
  })

  it('writes a typed id after switching to manual', () => {
    const { onChange } = renderField(MODELS, {})
    // Radix tabs activate on mousedown, not click.
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Manual' }))
    fireEvent.change(idInputs()[1], { target: { value: 'mimo-v2.7-pro' } })
    expect(onChange).toHaveBeenCalledWith({ opus: { id: 'mimo-v2.7-pro' } })
  })
})
