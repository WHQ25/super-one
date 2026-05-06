/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AddServerPanel } from './AddServerPanel'
import type { McpbPreview } from '@superone/shared/mcpb-types'

const settingsState = {
  saveMcpConfig: vi.fn().mockResolvedValue(undefined),
  fetchMcpConfigs: vi.fn().mockResolvedValue(undefined),
  fetchCodexMcpConfigs: vi.fn().mockResolvedValue(undefined),
  checkMcpServers: vi.fn().mockResolvedValue(undefined),
  fetchMcpbInstalled: vi.fn().mockResolvedValue(undefined),
}

vi.mock('@/stores/settings', () => ({
  useSettingsStore: () => settingsState,
}))

const previewMcpbMock = vi.fn()
const installMcpbMock = vi.fn()
const getPathForFileMock = vi.fn()

beforeEach(() => {
  previewMcpbMock.mockReset()
  installMcpbMock.mockReset()
  getPathForFileMock.mockReset()
  settingsState.saveMcpConfig.mockClear()
  settingsState.fetchMcpConfigs.mockClear()
  settingsState.fetchCodexMcpConfigs.mockClear()
  settingsState.checkMcpServers.mockClear()
  settingsState.fetchMcpbInstalled.mockClear()
  ;(window as unknown as { app: Record<string, unknown> }).app = {
    previewMcpb: previewMcpbMock,
    installMcpb: installMcpbMock,
    getPathForFile: getPathForFileMock,
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

function dropMcpbFile(target: HTMLElement, path: string) {
  const file = new File(['x'], path.split('/').pop() ?? 'file.mcpb', { type: 'application/zip' })
  getPathForFileMock.mockReturnValue(path)
  fireEvent.drop(target, {
    dataTransfer: { files: [file], types: ['Files'] },
  })
}

describe('AddServerPanel — bundle tab', () => {
  it('opens with the bundle drop zone visible by default', () => {
    render(
      <AddServerPanel
        provider="claude"
        cwd="/some/project"
        onClose={() => {}}
        onInstalled={() => {}}
        onError={() => {}}
      />
    )
    expect(screen.getByText('Install from .mcpb bundle')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('my-server')).not.toBeInTheDocument()
  })

  it('renders preview UI inline in the bundle tab after a .mcpb is dropped (no dialog)', async () => {
    previewMcpbMock.mockResolvedValue(basicPreview())
    render(
      <AddServerPanel
        provider="claude"
        cwd="/some/project"
        onClose={() => {}}
        onInstalled={() => {}}
        onError={() => {}}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Bundle (.mcpb)' }))
    const dropZone = screen.getByText('Install from .mcpb bundle').closest('button')!
    dropMcpbFile(dropZone, '/tmp/demo.mcpb')

    expect(await screen.findByText('Demo Server')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(previewMcpbMock).toHaveBeenCalledWith('/tmp/demo.mcpb')
  })

  it('passes provider, scope, manifestHash and userConfig values to installMcpb and closes the panel', async () => {
    previewMcpbMock.mockResolvedValue(basicPreview())
    installMcpbMock.mockResolvedValue({ meta: {}, installDir: '/x' })
    const onInstalled = vi.fn()
    const onClose = vi.fn()

    render(
      <AddServerPanel
        provider="codex"
        cwd="/some/project"
        onClose={onClose}
        onInstalled={onInstalled}
        onError={() => {}}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Bundle (.mcpb)' }))
    const dropZone = screen.getByText('Install from .mcpb bundle').closest('button')!
    dropMcpbFile(dropZone, '/tmp/demo.mcpb')

    await screen.findByText('Demo Server')
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'sk-test' } })

    const installBtn = screen.getByRole('button', { name: 'Install' })
    await waitFor(() => expect(installBtn).not.toBeDisabled())
    fireEvent.click(installBtn)

    await waitFor(() => expect(installMcpbMock).toHaveBeenCalledTimes(1))
    expect(installMcpbMock).toHaveBeenCalledWith({
      filePath: '/tmp/demo.mcpb',
      provider: 'codex',
      scope: 'user',
      cwd: undefined,
      userConfig: { API_KEY: 'sk-test' },
      expectedManifestHash: 'abc123',
    })
    expect(settingsState.fetchCodexMcpConfigs).toHaveBeenCalled()
    expect(settingsState.checkMcpServers).not.toHaveBeenCalled()
    expect(onInstalled).toHaveBeenCalledWith('Demo Server')
    expect(onClose).toHaveBeenCalled()
  })

  it('surfaces preview errors inline and keeps the install button disabled', async () => {
    previewMcpbMock.mockRejectedValue(new Error('Invalid manifest:\nname: bad'))
    render(
      <AddServerPanel
        provider="claude"
        cwd={null}
        onClose={() => {}}
        onInstalled={() => {}}
        onError={() => {}}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Bundle (.mcpb)' }))
    const dropZone = screen.getByText('Install from .mcpb bundle').closest('button')!
    dropMcpbFile(dropZone, '/tmp/bad.mcpb')

    expect(await screen.findByText('Cannot read bundle')).toBeInTheDocument()
    expect(screen.getByText(/Invalid manifest/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Install' })).toBeDisabled()
  })

  it('disables project scope when no cwd is open', async () => {
    previewMcpbMock.mockResolvedValue(basicPreview())
    render(
      <AddServerPanel
        provider="claude"
        cwd={null}
        onClose={() => {}}
        onInstalled={() => {}}
        onError={() => {}}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Bundle (.mcpb)' }))
    const dropZone = screen.getByText('Install from .mcpb bundle').closest('button')!
    dropMcpbFile(dropZone, '/tmp/demo.mcpb')
    await screen.findByText('Demo Server')

    expect(screen.getByRole('button', { name: 'project' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'user' })).not.toBeDisabled()
  })
})

describe('AddServerPanel — manual tab', () => {
  it('saves a stdio config via saveMcpConfig and closes the panel on submit', async () => {
    const onClose = vi.fn()
    render(
      <AddServerPanel
        provider="claude"
        cwd="/some/project"
        onClose={onClose}
        onInstalled={() => {}}
        onError={() => {}}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Manual' }))
    fireEvent.change(screen.getByPlaceholderText('my-server'), { target: { value: 'fs' } })
    fireEvent.change(screen.getByPlaceholderText('npx'), { target: { value: 'npx' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(settingsState.saveMcpConfig).toHaveBeenCalledTimes(1))
    expect(settingsState.saveMcpConfig).toHaveBeenCalledWith(
      'fs',
      expect.objectContaining({ type: 'stdio', command: 'npx', args: [], env: {} }),
      'user',
    )
    expect(onClose).toHaveBeenCalled()
  })

  it('preserves manual field values when switching tabs and back', async () => {
    render(
      <AddServerPanel
        provider="claude"
        cwd="/some/project"
        onClose={() => {}}
        onInstalled={() => {}}
        onError={() => {}}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Manual' }))
    fireEvent.change(screen.getByPlaceholderText('my-server'), { target: { value: 'kept' } })
    fireEvent.click(screen.getByRole('button', { name: 'Bundle (.mcpb)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Manual' }))
    expect((screen.getByPlaceholderText('my-server') as HTMLInputElement).value).toBe('kept')
  })
})
