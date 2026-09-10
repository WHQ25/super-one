export function hostMessageIsReady(raw: string): boolean {
  try {
    return (JSON.parse(raw) as { type?: string }).type === 'ready'
  } catch {
    return false
  }
}

/** Paint the document chrome before CSS/React, so WKWebView never flashes white. */
export function chatViewPrePaintScript(background: string, scheme: 'light' | 'dark'): string {
  return `(function(){var r=document.documentElement;r.style.background=${JSON.stringify(background)};r.style.colorScheme=${JSON.stringify(scheme)};if(${scheme === 'dark'})r.classList.add('dark');else r.classList.remove('dark');if(document.body)document.body.style.background=${JSON.stringify(background)};})();true;`
}
