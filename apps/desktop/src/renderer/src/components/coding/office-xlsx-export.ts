/**
 * `exportXlsx` writes the sanitized workbook, then starts a browser download.
 * Keep that blob and skip the download. The hooks are restored before this returns.
 */
export async function captureAnchorDownload(run: () => void): Promise<Uint8Array> {
  const originalClick = HTMLAnchorElement.prototype.click
  const originalCreate = URL.createObjectURL
  const originalRevoke = URL.revokeObjectURL
  const captured: { blob: Blob | null } = { blob: null }
  let thrown: unknown
  URL.createObjectURL = ((value: Blob | MediaSource) => {
    if (value instanceof Blob) captured.blob = value
    return originalCreate.call(URL, value)
  }) as typeof URL.createObjectURL
  HTMLAnchorElement.prototype.click = () => {}
  URL.revokeObjectURL = () => {}
  try {
    try {
      run()
    } catch (err) {
      thrown = err
    } finally {
      HTMLAnchorElement.prototype.click = originalClick
      URL.createObjectURL = originalCreate
    }
    if (thrown) throw thrown
    const saved = captured.blob
    if (!saved) throw new Error('workbook export did not produce a file')
    return new Uint8Array(await saved.arrayBuffer())
  } finally {
    URL.revokeObjectURL = originalRevoke
  }
}
