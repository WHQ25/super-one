type LinkConfirmHandler = (url: string) => void

let handler: LinkConfirmHandler | null = null

export function setExternalLinkHandler(h: LinkConfirmHandler): () => void {
  handler = h
  return () => { handler = null }
}

export function requestOpenExternalLink(url: string): void {
  if (handler) handler(url)
  else window.app.openExternalLink(url)
}
