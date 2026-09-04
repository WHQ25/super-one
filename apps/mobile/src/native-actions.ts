import type { HostInbound, HostOutbound } from '@superone/chat-view'

type NativeRequest = Extract<HostOutbound, { type: 'requestNative' }>
type NativeResult = Extract<HostInbound, { type: 'nativeActionResult' }>

export interface NativeActionPorts {
  openLink(url: string): Promise<void>
  openFile(path: string): Promise<void>
  previewFile(path: string): Promise<void>
  copyText(text: string): Promise<void>
}

function payloadString(message: NativeRequest, key: string): string {
  const value = (message.payload as Record<string, unknown> | undefined)?.[key]
  if (typeof value !== 'string' || !value) throw new Error(`invalid ${message.action} payload`)
  return value
}

export async function resolveNativeRequest(
  message: NativeRequest,
  ports: NativeActionPorts,
): Promise<NativeResult> {
  try {
    if (message.action === 'openLink') {
      const url = payloadString(message, 'url')
      if (!/^https?:\/\//i.test(url)) throw new Error('unsupported link')
      await ports.openLink(url)
    } else if (message.action === 'openFile' || message.action === 'showInFolder') {
      await ports.openFile(payloadString(message, 'path'))
    } else if (message.action === 'previewFile') {
      await ports.previewFile(payloadString(message, 'path'))
    } else if (message.action === 'copyText') {
      await ports.copyText(payloadString(message, 'text'))
    } else {
      throw new Error(`${message.action} is not available on mobile`)
    }
    return { type: 'nativeActionResult', requestId: message.requestId, result: { ok: true } }
  } catch (error) {
    return {
      type: 'nativeActionResult',
      requestId: message.requestId,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
