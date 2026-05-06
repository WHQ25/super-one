type ClipboardReadHandler = (appId: string) => Promise<string | null>
type ClipboardWriteHandler = (appId: string, text: string) => void

let readHandler: ClipboardReadHandler | null = null
let writeHandler: ClipboardWriteHandler | null = null

export function setClipboardReadHandler(h: ClipboardReadHandler): () => void {
  readHandler = h
  return () => { readHandler = null }
}

export function setClipboardWriteHandler(h: ClipboardWriteHandler): () => void {
  writeHandler = h
  return () => { writeHandler = null }
}

export async function requestClipboardRead(appId: string): Promise<string> {
  if (readHandler) {
    const result = await readHandler(appId)
    if (result === null) throw new Error('Clipboard read denied by user')
    return result
  }
  return window.app.clipboardRead()
}

export function requestClipboardWrite(appId: string, text: string): void {
  if (writeHandler) writeHandler(appId, text)
  else window.app.clipboardWrite(text)
}
