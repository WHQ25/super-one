export function safeSharedFileName(shareId: string, originalName: string): string {
  const basename = originalName.split(/[\\/]/).pop() ?? ''
  const cleaned = basename
    .replace(/[\u0000-\u001f\u007f:]/g, '_')
    .replace(/^\.+$/, '')
    .slice(-120)
  const safeId = shareId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || 'received'
  return `${safeId}-${cleaned || 'shared-file'}`
}

export function formatFileSize(size: number): string {
  if (size < 1_024) return `${size} B`
  if (size < 1_024 * 1_024) return `${(size / 1_024).toFixed(1)} KB`
  return `${(size / (1_024 * 1_024)).toFixed(1)} MB`
}
