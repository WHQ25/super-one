/** Plain single-line XML text, including titles supplied by a remote node. */
function toastText(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** Compact native banner: system attribution, one title, one status, no actions. */
export function windowsToastXml(title: string, body: string): string {
  return `<toast duration="short"><visual><binding template="ToastGeneric"><text hint-maxLines="1">${toastText(title)}</text><text hint-maxLines="1">${toastText(body)}</text></binding></visual></toast>`
}
