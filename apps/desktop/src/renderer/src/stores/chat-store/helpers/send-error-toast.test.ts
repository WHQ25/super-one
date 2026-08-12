/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const toastError = vi.fn()
vi.mock('sonner', () => ({
  toast: { error: (...args: unknown[]) => toastError(...args) },
}))

vi.mock('i18next', () => ({
  default: {
    t: (key: string, opts?: { message?: string }) => {
      if (key === 'chat.send.remoteUnavailable') return 'remote-unavailable'
      if (key === 'chat.send.failed') return `failed:${opts?.message ?? ''}`
      return key
    },
  },
}))

const { openCursorApiKeyPrompt } = vi.hoisted(() => ({
  openCursorApiKeyPrompt: vi.fn(),
}))

vi.mock('../index', () => ({
  useChatStore: {
    getState: () => ({ openCursorApiKeyPrompt }),
  },
}))

import {
  isCursorApiKeyMissingError,
  isRemoteTransportSendError,
  toastSendFailure,
} from './send-error-toast'

describe('send-error-toast', () => {
  beforeEach(() => {
    toastError.mockClear()
    openCursorApiKeyPrompt.mockClear()
  })

  it('classifies transport / connectivity messages', () => {
    expect(isRemoteTransportSendError(new Error('rpc timeout: session.send'))).toBe(true)
    expect(isRemoteTransportSendError(new Error('not connected'))).toBe(true)
    expect(isRemoteTransportSendError(new Error('heartbeat timeout after 2 missed pongs'))).toBe(
      true,
    )
    expect(isRemoteTransportSendError(new Error('disk full'))).toBe(false)
  })

  it('detects Cursor missing API key (including IPC wrapper text)', () => {
    expect(
      isCursorApiKeyMissingError(
        new Error(
          "Error invoking remote method 'agent:send-message': Error: Cursor User API Key missing. Create one at https://cursor.com/dashboard/api",
        ),
      ),
    ).toBe(true)
    expect(isCursorApiKeyMissingError(new Error('disk full'))).toBe(false)
  })

  it('toasts the remote-unavailable copy for transport errors', () => {
    toastSendFailure(new Error('websocket closed'))
    expect(toastError).toHaveBeenCalledWith('remote-unavailable')
  })

  it('opens the API key prompt instead of toasting for missing Cursor key', async () => {
    toastSendFailure(new Error('Cursor User API Key missing'))
    expect(toastError).not.toHaveBeenCalled()
    await vi.waitFor(() => {
      expect(openCursorApiKeyPrompt).toHaveBeenCalled()
    })
  })

  it('toasts the generic failed copy otherwise', () => {
    toastSendFailure(new Error('disk full'))
    expect(toastError).toHaveBeenCalledWith('failed:disk full')
  })
})
