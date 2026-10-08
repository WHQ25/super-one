/** What `CachedFileViewer` hands an offline viewer page: the cached file and its name. */
export interface ViewerTarget { name: string; uri: string }

declare global {
  interface Window { viewerTarget: ViewerTarget }
}

/** The page's status line; empty hides it. */
export function setViewerStatus(message: string): void {
  document.getElementById('status')!.textContent = message
}

/** The cached file's bytes. */
export function readCachedFile(uri: string): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    // WebView's file access grants apply to XMLHttpRequest; fetch(file://)
    // rejects before the viewer sees any bytes on mobile WebViews.
    const request = new XMLHttpRequest()
    request.open('GET', uri)
    request.responseType = 'arraybuffer'
    request.onload = () => {
      if ((request.status !== 0 && (request.status < 200 || request.status >= 300)) || !(request.response instanceof ArrayBuffer)) {
        reject(new Error(`Could not read cached file (${request.status})`))
        return
      }
      resolve(request.response)
    }
    request.onerror = () => reject(new Error('Could not read cached file'))
    request.send()
  })
}
