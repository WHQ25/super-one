export function applyCrispText(enabled: boolean): void {
  const el = document.documentElement
  if (enabled) el.removeAttribute('data-crisp-text')
  else el.setAttribute('data-crisp-text', 'off')
}
