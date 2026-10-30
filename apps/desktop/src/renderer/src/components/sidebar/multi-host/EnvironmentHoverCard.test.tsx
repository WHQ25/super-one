/** @vitest-environment jsdom */
import { act, cleanup, render, screen } from '@testing-library/react'
import i18n from 'i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EnvironmentListItem } from '@superone/shared/environment'
import { EnvironmentHoverBody, EnvironmentHoverCard } from './EnvironmentHoverCard'

const item = {
  connectionId: 'node-1',
  environmentId: 'node-1',
  label: 'dev-server',
  kind: 'remote',
  state: 'connected',
  platform: { os: 'darwin', arch: 'arm64' },
  machine: { os: 'macOS 26.0', cpuModel: 'Apple M3 Max', cpuCores: 16, memoryBytes: 64 * 1024 ** 3 },
  endpointProfiles: [],
} as EnvironmentListItem

describe('environment hover details', () => {
  afterEach(async () => {
    cleanup()
    await act(async () => {
      await i18n.changeLanguage('en')
    })
  })

  it('reads the system and memory use when the card opens', async () => {
    const totalBytes = 64 * 1024 ** 3
    window.environment.listItems = vi.fn(async () => [item])
    window.environment.memory = vi.fn(async () => ({
      totalBytes,
      freeBytes: totalBytes - Math.round(18.4 * 1024 ** 3),
      cpuPercent: 23,
    }))
    render(
      <EnvironmentHoverCard
        open
        connectionId="node-1"
        label="dev-server"
        kind="cli-node"
        connection="connected"
        path="ssh"
        projectCount={2}
      >
        <div>row</div>
      </EnvironmentHoverCard>,
    )
    expect(await screen.findByText('macOS 26.0')).toBeInTheDocument()
    expect(screen.getByText('45.6GB Free')).toBeInTheDocument()
    expect(screen.queryByText(/64/)).toBeNull()
    expect(screen.getByText('Apple M3 Max · 23%')).toBeInTheDocument()
    expect(screen.getByText('macOS 26.0').closest('div')?.querySelector('.lucide-monitor')).toBeTruthy()
    expect(screen.getByText('Apple M3 Max · 23%').closest('div')?.querySelector('.lucide-cpu')).toBeTruthy()
    expect(screen.queryByText('SSH')).toBeNull()
    expect(screen.getByText('2 Projects')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Environment Settings' })).toBeNull()
  })

  it('shows the chip and installed memory saved while the host was connected', async () => {
    window.environment.listItems = vi.fn(async () => [item])
    window.environment.memory = vi.fn(async () => ({ totalBytes: null, freeBytes: null, cpuPercent: null }))
    render(
      <EnvironmentHoverCard
        open
        connectionId="node-1"
        label="dev-server"
        kind="cli-node"
        connection="offline"
      >
        <div>row</div>
      </EnvironmentHoverCard>,
    )
    expect(await screen.findByText('Apple M3 Max')).toBeInTheDocument()
    expect(screen.getByText('64GB')).toBeInTheDocument()
    expect(screen.queryByText(/Free/)).toBeNull()
    expect(screen.queryByText(/%/)).toBeNull()
  })

  it('shows stored total memory when free memory was not reported', () => {
    render(
      <EnvironmentHoverBody
        label="build-box"
        kind="cli-node"
        connection="offline"
        projectCount={null}
        details={{ cpu: { model: 'Apple M3 Max' }, memory: { totalBytes: 32 * 1024 ** 3, freeBytes: null } }}
      />,
    )
    expect(screen.getByText('Apple M3 Max')).toBeInTheDocument()
    expect(screen.getByText('32GB')).toBeInTheDocument()
    expect(screen.queryByText(/Free/)).toBeNull()
    expect(screen.queryByText(/%/)).toBeNull()
  })

  it('says the free memory is available in Chinese', async () => {
    await i18n.changeLanguage('zh')
    render(
      <EnvironmentHoverBody
        label="build-box"
        kind="cli-node"
        connection="connected"
        details={{ memory: { totalBytes: 64 * 1024 ** 3, freeBytes: 32 * 1024 ** 3 } }}
      />,
    )
    expect(screen.getByText('32GB 可用')).toBeInTheDocument()
  })

  it('shows a core count when the chip name was not reported', () => {
    render(
      <EnvironmentHoverBody
        label="build-box"
        kind="cli-node"
        connection="connected"
        details={{ cpu: { percent: 12, cores: 8 } }}
      />,
    )
    expect(screen.getByText('8 cores · 12%')).toBeInTheDocument()
  })

  it('marks the name with the device kind', () => {
    const { container, rerender } = render(
      <EnvironmentHoverBody label="This Mac" kind="local" connection="connected" />,
    )
    const icon = () => container.querySelector('[data-slot="environment-device-icon"] svg')
    expect(icon()?.getAttribute('class')).toContain('lucide-laptop')
    expect(screen.getByText('This Computer').closest('div')?.querySelector('.lucide-computer')).toBeTruthy()
    expect(screen.getByText('This Computer')).toBeInTheDocument()
    expect(screen.queryByText(/Connected/)).toBeNull()
    rerender(<EnvironmentHoverBody label="MacBook-B" kind="remote-desktop" connection="connected" />)
    expect(icon()?.getAttribute('class')).toContain('lucide-monitor')
    rerender(<EnvironmentHoverBody label="dev-server" kind="cli-node" connection="offline" />)
    expect(icon()?.getAttribute('class')).toContain('lucide-server')
  })
})
