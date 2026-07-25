export type BrowserToolReply = {
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; data: string; mimeType: string }
  >
  isError?: boolean
}

export function browserTextReply(data: unknown): BrowserToolReply {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] }
}

export function browserToonReply(encode: (data: unknown) => string, data: unknown): BrowserToolReply {
  return { content: [{ type: 'text', text: encode(data) }] }
}

export function browserErrorReply(err: unknown): BrowserToolReply {
  return {
    content: [{ type: 'text', text: `[Error] ${err instanceof Error ? err.message : String(err)}` }],
    isError: true,
  }
}
