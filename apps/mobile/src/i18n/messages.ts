import { voiceChinese } from '../voice/voice-messages'
import type { Locale } from '@superone/shared/agent-types'
import { pasteChipChinese, pasteChipEnglish } from './paste-chip-messages'
import { scheduledSendChinese, scheduledSendEnglish } from './scheduled-send-messages'
import { sessionContinuationChinese, sessionContinuationEnglish } from './session-continuation-messages'
import { qrScannerChinese, qrScannerEnglish } from './qr-scanner-messages'

import { mobileEnglish } from './messages-en'
import { mobileChinese } from './messages-zh'

type Copy = Record<string, string>

const copy: Record<Locale, Copy> = { en: { ...mobileEnglish, ...pasteChipEnglish, ...scheduledSendEnglish, ...sessionContinuationEnglish, ...qrScannerEnglish }, zh: { ...mobileChinese, ...pasteChipChinese, ...voiceChinese, ...scheduledSendChinese, ...sessionContinuationChinese, ...qrScannerChinese } }

export function translateMobileText(locale: Locale, source: string): string {
  const retry = /^Retrying in (\d+)s$/.exec(source)
  if (retry) return locale === 'zh' ? `${retry[1]} 秒后重试` : source
  const launches = /^(\d+) requested launch(es)?$/.exec(source)
  if (launches) return locale === 'zh' ? `请求启动 ${launches[1]} 个会话` : source
  return copy[locale][source] ?? source
}
