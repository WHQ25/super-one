import { createRequire } from 'node:module'

let cached: string | null | undefined

export function resolveSdkClaudeBinary(): string | undefined {
  if (cached !== undefined) return cached ?? undefined
  try {
    const req = createRequire(import.meta.url)
    const ext = process.platform === 'win32' ? '.exe' : ''
    const candidates = process.platform === 'linux'
      ? [
          `@anthropic-ai/claude-agent-sdk-linux-${process.arch}-musl/claude${ext}`,
          `@anthropic-ai/claude-agent-sdk-linux-${process.arch}/claude${ext}`,
        ]
      : [`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/claude${ext}`]
    for (const c of candidates) {
      try {
        let p = req.resolve(c)
        if (p.includes('/app.asar/')) p = p.replace('/app.asar/', '/app.asar.unpacked/')
        cached = p
        return p
      } catch { /* try next */ }
    }
  } catch { /* fall through */ }
  cached = null
  return undefined
}
