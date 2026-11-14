/** @vitest-environment jsdom */

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Toaster } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MarketplacePlugin } from '@superone/shared/agent-types'
import { useAppStore } from '@/stores/app'
import { useSettingsStore } from '@/stores/settings'
import { PluginsPage } from './PluginsPage'

const plugin: MarketplacePlugin = {
  name: 'frontend-design',
  displayName: 'Frontend Design',
  marketplace: 'claude-plugins-official',
  key: 'frontend-design@claude-plugins-official',
  description: 'Distinctive visual design guidance.',
  installed: false,
  marketplaceScope: 'user',
  marketplaceSource: '/Users/me/plugins',
}

function row(name: string): HTMLElement {
  const title = screen.getByText(name)
  const header = title.closest('[role="button"]')
  if (!(header instanceof HTMLElement)) throw new Error(`missing row for ${name}`)
  return header
}

describe('Claude plugin install', () => {
  beforeEach(() => {
    useAppStore.setState({ settingsProvider: 'claude', currentFolder: '/proj' })
    useSettingsStore.setState({
      plugins: [],
      marketplacePlugins: [],
      pluginsLoading: false,
      pluginDetail: null,
      marketplacePluginDetail: null,
    })
    Object.assign(window.app, {
      listPlugins: vi.fn().mockResolvedValue([]),
      listMarketplacePlugins: vi.fn().mockResolvedValue([plugin]),
      installPlugin: vi.fn().mockRejectedValue(new Error('unknown option \'--project-path\'')),
    })
  })

  it('shows the CLI error after the scope choice instead of closing quietly', async () => {
    const user = userEvent.setup()
    render(
      <>
        <PluginsPage />
        <Toaster position="bottom-center" />
      </>,
    )

    await user.click(await screen.findByText('claude-plugins-official'))
    await user.click(within(row('Frontend Design')).getByRole('button', { name: 'Install' }))
    await user.click(within(row('Frontend Design')).getByRole('button', { name: 'project' }))

    expect(await screen.findByText('Could not install Frontend Design: unknown option \'--project-path\'')).toBeInTheDocument()
    expect(window.app.installPlugin).toHaveBeenCalledWith('/proj', plugin.key, 'project')
    expect(within(row('Frontend Design')).getByRole('button', { name: 'Install' })).toBeEnabled()
  })
})
