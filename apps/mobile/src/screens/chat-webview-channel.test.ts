import { describe, expect, it, vi } from 'vitest'
import { createChatWebViewChannel } from './chat-webview-channel'

const planApproval = { type: 'requestNative', requestId: 'native-1', action: 'codexPlanApproval', payload: { approved: true } }

function open() {
  const deliver = vi.fn()
  const channel = createChatWebViewChannel(deliver)
  const ready = JSON.stringify({ type: 'ready' })
  expect(channel.receive(ready)).toBe(ready)
  const token = deliver.mock.calls[0]![0].token as string
  return { channel, deliver, token }
}

describe('chat WebView channel', () => {
  it('issues a secret on ready and passes only messages that carry it', () => {
    const { channel, deliver, token } = open()
    expect(deliver).toHaveBeenCalledWith({ type: 'channelToken', token })
    expect(token).toMatch(/^[0-9a-f]{32}$/)
    const signed = JSON.stringify({ ...planApproval, channel: token })
    expect(channel.receive(signed)).toBe(signed)
  })

  it('drops a plan approval forged by a frame inside the chat document', () => {
    const { channel } = open()
    // Before the gate, a widget calling webkit.messageHandlers / ReactNativeWebView reached RN.
    expect(channel.receive(JSON.stringify(planApproval))).toBeNull()
    expect(channel.receive(JSON.stringify({ ...planApproval, channel: 'guess' }))).toBeNull()
  })

  it('does not reissue the secret to a forged ready or accept a late boot error', () => {
    const { channel, deliver } = open()
    expect(channel.receive(JSON.stringify({ type: 'ready' }))).toBeNull()
    expect(channel.receive(JSON.stringify({ type: 'error', fatal: true, message: 'x' }))).toBeNull()
    expect(deliver).toHaveBeenCalledTimes(1)
  })

  it('accepts boot messages again after the main frame loads a new document', () => {
    const { channel, deliver, token } = open()
    const error = JSON.stringify({ type: 'error', fatal: true, message: 'boot failed' })
    channel.reset()
    expect(channel.receive(JSON.stringify({ ...planApproval, channel: token }))).toBeNull()
    expect(channel.receive(error)).toBe(error)
    expect(channel.receive(JSON.stringify({ type: 'ready' }))).not.toBeNull()
    expect(deliver.mock.calls[1]![0].token).not.toBe(token)
  })

  it('drops messages that are not JSON objects', () => {
    const { channel } = open()
    expect(channel.receive('not json')).toBeNull()
    expect(channel.receive('null')).toBeNull()
  })
})
