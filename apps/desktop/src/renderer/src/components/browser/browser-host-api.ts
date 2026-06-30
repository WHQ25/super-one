const registry = new Map<string, Electron.WebviewTag>()

export function registerBrowserWebview(id: string, el: Electron.WebviewTag | null): () => void {
  if (el) registry.set(id, el)
  return () => {
    if (registry.get(id) === el) registry.delete(id)
  }
}

export function browserNavigate(id: string, url: string): void {
  registry.get(id)?.loadURL(url)
}

export function browserGoBack(id: string): void {
  registry.get(id)?.goBack()
}

export function browserGoForward(id: string): void {
  registry.get(id)?.goForward()
}

export function browserReload(id: string): void {
  registry.get(id)?.reload()
}

export function browserStop(id: string): void {
  registry.get(id)?.stop()
}
