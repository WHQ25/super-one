/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { McpbInstallDialog } from './McpbInstallDialog'
import type { McpbPreview } from '../../../shared/mcpb-types'

const settingsState = {
  fetchMcpConfigs: vi.fn().mockResolvedValue(undefined),
  fetchCodexMcpConfigs: vi.fn().mockResolvedValue(undefined),
  checkMcpServers: vi.fn().mockResolvedValue(undefined),
  fetchMcpbInstalled: vi.fn().mockResolvedValue(undefined),
}

vi.mock('@/stores/settings', () => ({
  useSettingsStore: (selector: (s: typeof settingsState) => unknown) => selector(settingsState),
}))

const previewMcpbMock = vi.fn()
const installMcpbMock = vi.fn()

beforeEach(() => {
  previewMcpbMock.mockReset()
  installMcpbMock.mockReset()
  settingsState.fetchMcpConfigs.mockClear()
  settingsState.fetchCodexMcpConfigs.mockClear()
  settingsState.checkMcpServers.mockClear()
  settingsState.fetchMcpbInstalled.mockClear()
  ;(window as unknown as { app: Record<string, unknown> }).app = {
    previewMcpb: previewMcpbMock,
    installMcpb: installMcpbMock,
  }
})

afterEach(() => {
  vi.clearAllMocks()
})

function basicPreview(): McpbPreview {
  return {
    manifestHash: 'abc123',
    iconDataUrl: undefined,
    warnings: [],
    runtime: { ok: true, type: 'node' },
    platformSupported: true,
    manifest: {
      manifest_version: '0.3',
      name: 'demo-server',
      display_name: 'Demo Server',
      version: '1.0.0',
      description: 'A test bundle',
      author: { name: 'Tester' },
      server: {
        type: 'node',
        entry_point: 'server/index.js',
        mcp_config: { command: 'node', args: ['${__dirname}/server/index.js'], env: {} },
      },
      user_config: {
        API_KEY: { type: 'string', title: 'API Key', required: true, sensitive: true, multiple: false },
      },
      tools: [{ name: 'echo', description: 'Echo a message' }],
      tools_generated: false,
      prompts: [],
      prompts_generated: false,
    },
  }
}

describe('McpbInstallDialog', () => {
  it('does not call previewMcpb when filePath is null (closed state)', () => {
    render(
      <McpbInstallDialog
        filePath={null}
        provider="claude"
        onClose={() => {}}
        onInstalled={() => {}}
        onError={() => {}}
      />
    )
    expect(previewMcpbMock).not.toHaveBeenCalled()
  })

  it('renders manifest preview, scope choices and required-field gating after preview resolves', async () => {
    previewMcpbMock.mockResolvedValue(basicPreview())
    render(
      <McpbInstallDialog
        filePath="/tmp/demo.mcpb"
        provider="claude"
        onClose={() => {}}
        onInstalled={() => {}}
        onError={() => {}}
      />
    )

    expect(await screen.findByText('Demo Server')).toBeInTheDocument()
    expect(screen.getByText(/by Tester/)).toBeInTheDocument()
    expect(screen.getByText('All projects (user)')).toBeInTheDocument()
    expect(screen.getByText('This project only')).toBeInTheDocument()

    const installBtn = screen.getByRole('button', { name: 'Install' })
    expect(installBtn).toBeDisabled()
  })

  it('rejects install before scope is chosen and a required user_config field has no value', async () => {
    previewMcpbMock.mockResolvedValue(basicPreview())
    render(
      <McpbInstallDialog
        filePath="/tmp/demo.mcpb"
        provider="claude"
        onClose={() => {}}
        onInstalled={() => {}}
        onError={() => {}}
      />
    )
    await screen.findByText('Demo Server')
    fireEvent.click(screen.getByRole('button', { name: 'Install' }))
    expect(installMcpbMock).not.toHaveBeenCalled()
  })

  it('passes provider, scope, manifestHash and userConfig values to installMcpb', async () => {
    previewMcpbMock.mockResolvedValue(basicPreview())
    installMcpbMock.mockResolvedValue({ meta: {}, installDir: '/x' })
    const onInstalled = vi.fn()
    const onClose = vi.fn()

    render(
      <McpbInstallDialog
        filePath="/tmp/demo.mcpb"
        provider="codex"
        onClose={onClose}
        onInstalled={onInstalled}
        onError={() => {}}
      />
    )
    await screen.findByText('Demo Server')

    fireEvent.click(screen.getByRole('button', { name: 'All projects (user)' }))

    const apiKeyInput = screen.getByLabelText('API Key') as HTMLInputElement
    fireEvent.change(apiKeyInput, { target: { value: 'sk-test' } })

    const installBtn = screen.getByRole('button', { name: 'Install' })
    await waitFor(() => expect(installBtn).not.toBeDisabled())
    fireEvent.click(installBtn)

    await waitFor(() => expect(installMcpbMock).toHaveBeenCalledTimes(1))
    expect(installMcpbMock).toHaveBeenCalledWith({
      filePath: '/tmp/demo.mcpb',
      provider: 'codex',
      scope: 'user',
      userConfig: { API_KEY: 'sk-test' },
      expectedManifestHash: 'abc123',
    })
    expect(settingsState.fetchCodexMcpConfigs).toHaveBeenCalled()
    expect(settingsState.checkMcpServers).not.toHaveBeenCalled()
    expect(onInstalled).toHaveBeenCalledWith('Demo Server')
    expect(onClose).toHaveBeenCalled()
  })

  it('uses fetchMcpConfigs + checkMcpServers refresh when provider is claude', async () => {
    previewMcpbMock.mockResolvedValue(basicPreview())
    installMcpbMock.mockResolvedValue({ meta: {}, installDir: '/x' })

    render(
      <McpbInstallDialog
        filePath="/tmp/demo.mcpb"
        provider="claude"
        onClose={() => {}}
        onInstalled={() => {}}
        onError={() => {}}
      />
    )
    await screen.findByText('Demo Server')

    fireEvent.click(screen.getByRole('button', { name: 'All projects (user)' }))
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'k' } })
    fireEvent.click(screen.getByRole('button', { name: 'Install' }))

    await waitFor(() => expect(installMcpbMock).toHaveBeenCalled())
    expect(settingsState.fetchMcpConfigs).toHaveBeenCalled()
    expect(settingsState.checkMcpServers).toHaveBeenCalled()
    expect(settingsState.fetchCodexMcpConfigs).not.toHaveBeenCalled()
  })

  it('surfaces preview errors and keeps install button disabled', async () => {
    previewMcpbMock.mockRejectedValue(new Error('Invalid manifest:\nname: bad'))
    render(
      <McpbInstallDialog
        filePath="/tmp/bad.mcpb"
        provider="claude"
        onClose={() => {}}
        onInstalled={() => {}}
        onError={() => {}}
      />
    )

    expect(await screen.findByText('Cannot read bundle')).toBeInTheDocument()
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/Invalid manifest/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Install' })).toBeDisabled()
  })

  it('shows bundle warnings and reflects platform/runtime issues', async () => {
    const incompatible: McpbPreview = {
      ...basicPreview(),
      platformSupported: false,
      warnings: ['This bundle does not support darwin.'],
    }
    previewMcpbMock.mockResolvedValue(incompatible)
    render(
      <McpbInstallDialog
        filePath="/tmp/demo.mcpb"
        provider="claude"
        onClose={() => {}}
        onInstalled={() => {}}
        onError={() => {}}
      />
    )
    expect(await screen.findByText('Demo Server')).toBeInTheDocument()
    expect(screen.getByText(/does not support darwin/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'All projects (user)' }))
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'k' } })
    expect(screen.getByRole('button', { name: 'Install' })).toBeDisabled()
  })
})
