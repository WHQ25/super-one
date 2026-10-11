import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isSingleWebLink } from '@superone/shared/web-links'

const editor = resolve(import.meta.dirname, '../modules/mention-editor')
/** The pattern literal a native editor uses to keep a lone pasted link out of a Paste Chip. */
function nativePattern(file: string, declaration: RegExp): RegExp {
  const literal = declaration.exec(readFileSync(resolve(editor, file), 'utf8'))?.[1]
  if (!literal) throw new Error(`${file}: single web link pattern not found`)
  return new RegExp(literal.replace(/\\(.)/g, '$1'), 'i')
}

const natives = {
  ios: nativePattern('ios/MentionEditorView.swift', /static let singleWebLink = "((?:[^"\\]|\\.)*)"/),
  android: nativePattern('android/src/main/java/expo/modules/mentioneditor/MentionEditorView.kt', /SINGLE_WEB_LINK = Regex\("((?:[^"\\]|\\.)*)"/),
}

const cases = [
  'https://example.com', '  https://example.com/a/b?c=d#e\n', `https://example.com/${'x'.repeat(600)}`, 'HTTP://EXAMPLE.COM',
  'https://example.com.', 'https://example.com and more', 'see https://example.com', 'https://', 'https://a.com\nhttps://b.com',
  'ftp://example.com', 'https://例子.测试/路径', 'https://example.com/a，b',
]

describe('native paste mirrors isSingleWebLink', () => {
  for (const [platform, pattern] of Object.entries(natives)) {
    it(platform, () => {
      for (const text of cases) expect([text, pattern.test(text.trim())]).toEqual([text, isSingleWebLink(text)])
    })
  }
})
