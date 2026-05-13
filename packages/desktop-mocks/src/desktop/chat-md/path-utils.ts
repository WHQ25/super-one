export function toLocalFileUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/")
  const encoded = encodeURI(normalized).replace(/#/g, "%23")
  return /^[A-Za-z]:/.test(normalized)
    ? `local-file:///${encoded}`
    : `local-file://${encoded}`
}

export function toMediaUrl(filePath: string): string {
  return toLocalFileUrl(filePath)
}
