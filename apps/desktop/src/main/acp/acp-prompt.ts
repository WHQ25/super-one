import { pathToFileURL } from 'node:url'
import { attachmentPrompt, buildAttachmentTurn } from '@superone/shared/attachment-turn'
import { validateTurnAttachments } from '@superone/shared/attachment-validation'
export interface BuildAcpPromptOptions {
  images?: Array<{ mimeType: string; base64: string; name?: string }>
  /** Absolute project cwd for resolving relative @file mentions. */
  cwd?: string
  getUnsaved?: (absolutePath: string) => string | null | undefined
  /** Optional file reader (tests inject). Defaults to fs readFile. */
  readFile?: (absolutePath: string) => Promise<string | null>
  maxResourceBytes?: number
}

/** Build ACP prompt ContentBlocks from SuperOne send payload (sync images + text only). */
export function buildAcpPromptContent(
  text: string,
  images?: Array<{ mimeType: string; base64: string; name?: string }>,
): Array<{ type: string; [k: string]: unknown }> {
  return buildAcpPromptContentSync(text, { images })
}

function buildAcpPromptContentSync(
  text: string,
  opts: BuildAcpPromptOptions,
): Array<{ type: string; [k: string]: unknown }> {
  validateTurnAttachments(opts.images, text)
  const turn = buildAttachmentTurn(opts.images, { inlineImages: true, inlinePdf: false, requirePaths: true })
  const blocks: Array<{ type: string; [k: string]: unknown }> = []
  for (const image of turn.attachments.filter(a => a.inline)) {
    blocks.push({ type: 'image', mimeType: image.mimeType, data: image.base64, uri: pathToFileURL(image.path!).href })
  }
  blocks.push({ type: 'text', text: attachmentPrompt(text, turn.note) })
  return blocks
}

/** Build prompt including embedded file resources for @file mentions. */
export async function buildAcpPromptContentAsync(
  text: string,
  opts: BuildAcpPromptOptions = {},
): Promise<Array<{ type: string; [k: string]: unknown }>> {
  const blocks = buildAcpPromptContentSync(text, opts)
  const mentions = extractFileMentions(text)
  if (mentions.length === 0) return blocks

  const { resolve, isAbsolute } = await import('node:path')
  const maxBytes = opts.maxResourceBytes ?? 512 * 1024
  const defaultRead = async (abs: string): Promise<string | null> => {
    try {
      const { readFile, stat } = await import('node:fs/promises')
      const info = await stat(abs)
      if (!info.isFile() || info.size > maxBytes) return null
      return await readFile(abs, 'utf8')
    } catch {
      return null
    }
  }
  const readFile = opts.readFile ?? defaultRead
  const cwd = opts.cwd

  for (const mention of mentions) {
    const abs = isAbsolute(mention)
      ? resolve(mention)
      : cwd
        ? resolve(cwd, mention)
        : resolve(mention)
    const unsaved = opts.getUnsaved?.(abs)
    const body = typeof unsaved === 'string' ? unsaved : await readFile(abs)
    if (body == null) continue
    const uri = abs.startsWith('/') ? `file://${abs}` : `file:///${abs}`
    blocks.push({
      type: 'resource',
      resource: {
        uri,
        mimeType: 'text/plain',
        text: body,
      },
    })
  }
  return blocks
}


const FILE_MENTION_RE = /(?:^|\s)@([^\s]+)/g

export function extractFileMentions(text: string): string[] {
  const out: string[] = []
  const re = new RegExp(FILE_MENTION_RE)
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const value = m[1]
    if (!value) continue
    // skip bare words without path/extension-ish shape (agents/miniapps)
    if (!value.includes('/') && !value.includes('.')) continue
    if (value.endsWith('/')) continue
    out.push(value)
  }
  return [...new Set(out)]
}
