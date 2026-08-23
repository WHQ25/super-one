/** @vitest-environment jsdom */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DshPluginsPage } from './DshPluginsPage'

const originalApp = window.app

describe('DeepSeek plugin settings', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'app', {
      configurable: true,
      value: {
        dshListPlugins: vi.fn().mockResolvedValue({
          bundled: [
            {
              name: '@deepseek-ai/dsh-agent-loop',
              version: '0.1.1-rc.2',
              scopes: ['core'],
            },
          ],
          plugins: [
            {
              id: 'third-party-example',
              name: '@example/dsh-plugin',
              version: '1.2.3',
              disabled: false,
              status: null,
            },
          ],
          root: '/plugins',
        }),
      },
    })
  })

  afterEach(() => {
    Object.defineProperty(window, 'app', {
      configurable: true,
      value: originalApp,
    })
  })

  it('switches between official and third-party plugin card grids', async () => {
    const user = userEvent.setup()
    render(<DshPluginsPage />)

    expect(
      await screen.findByText('@deepseek-ai/dsh-agent-loop'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('list', { name: 'Built-in official plugins' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('@example/dsh-plugin')).not.toBeInTheDocument()

    await user.click(
      screen.getByRole('tab', { name: /Installed third-party plugins/ }),
    )

    expect(screen.getByText('@example/dsh-plugin')).toBeInTheDocument()
    expect(
      screen.getByRole('list', { name: 'Installed third-party plugins' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByText('@deepseek-ai/dsh-agent-loop'),
    ).not.toBeInTheDocument()
  })
})
