/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import { BUILTIN_PLATFORMS, type Credential } from '@superone/shared/platform-registry'
import { afterEach, describe, expect, it } from 'vitest'
import { useSettingsStore } from '@/stores/settings'
import { DefaultProviderRow } from './DefaultProviderRow'

const platforms = BUILTIN_PLATFORMS.filter((platform) => platform.id === 'openai')

function credential(id: string, name: string): Credential {
  return {
    id,
    platformId: 'openai',
    planId: 'api',
    name,
    secret: '',
    notes: '',
    sortOrder: 0,
    overrides: {
      openai: { models: [{ id: 'gpt-image-1', name: 'GPT Image', tasks: ['image'] }] },
    },
  }
}

function renderRow(credentials: Credential[], credentialId: string) {
  useSettingsStore.setState({
    platforms,
    credentials,
    bindings: [{ consumer: 'media:image', credentialId }],
    fetchProviderData: async () => {},
    setBinding: async () => {},
    clearBinding: async () => {},
  })
  render(
    <DefaultProviderRow
      consumer="media:image"
      title="Image Provider"
      description="Which provider generates images."
      fallback={<span>Auto</span>}
    />,
  )
}

afterEach(() => {
  cleanup()
  useSettingsStore.setState({ platforms: [], credentials: [], bindings: [] })
})

describe('DefaultProviderRow', () => {
  it('shows the provider name without the key name when that provider has one key', () => {
    renderRow([credential('oa', 'Work')], 'oa')
    expect(screen.getByRole('button')).toBeTruthy()
    expect(screen.queryByText('Work')).toBeNull()
  })

  it('shows the key name when that provider has more than one key', () => {
    renderRow([credential('oa', 'Work'), credential('oa-2', 'Studio')], 'oa')
    expect(screen.getByText('Work')).toBeTruthy()
  })
})