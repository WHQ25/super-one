export type AttachmentSizeResult = 'valid' | 'invalid' | 'too-large'

export function decodedBase64ByteLength(value: string): number | null {
  const comma = value.indexOf(',')
  if (comma >= 0 && !/;base64$/i.test(value.slice(0, comma))) return null
  const body = (comma >= 0 ? value.slice(comma + 1) : value).replace(/\s/g, '')
  if (!body) return 0
  const match = /^([A-Za-z0-9+/]*)(={0,2})$/.exec(body)
  if (!match) return null
  const contentLength = match[1]?.length ?? 0
  const paddingLength = match[2]?.length ?? 0
  if (contentLength % 4 === 1 || (paddingLength > 0 && body.length % 4 !== 0)) return null
  return Math.floor(contentLength * 6 / 8)
}

export function classifyAttachmentSize(
  base64: string,
  declaredBytes: number | null | undefined,
  maxBytes: number,
): AttachmentSizeResult {
  const decodedBytes = decodedBase64ByteLength(base64)
  if (decodedBytes == null) return 'invalid'
  if ((declaredBytes != null && declaredBytes > maxBytes) || decodedBytes > maxBytes) {
    return 'too-large'
  }
  return 'valid'
}
