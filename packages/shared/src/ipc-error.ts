/**
 * Electron wraps `ipcRenderer.invoke` failures as
 * `Error invoking remote method 'channel': Error: <actual>`. Strip that so the
 * UI can show (and match on) the underlying message.
 */
export function unwrapIpcInvokeError(message: string): string {
  const unwrapped = message
    .replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i, '')
    .trim()
  return unwrapped || message
}
