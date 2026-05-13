import { wrapMiniAppMention } from './miniapp-mention-marker'

export const MINIAPP_TAG_REGEX = /<superone-miniapp>\s*<appname>([\s\S]*?)<\/appname>\s*<appid>([\s\S]*?)<\/appid>\s*<\/superone-miniapp>/g
export const MINIAPP_REMINDER_REGEX = /\n*<superone-miniapp-reminder>[\s\S]*?<\/superone-miniapp-reminder>\n*/g

export function replaceMiniAppTagsWithMention(text: string): string {
  return text
    .replace(MINIAPP_REMINDER_REGEX, '')
    .replace(MINIAPP_TAG_REGEX, (_, appName, appId) =>
      wrapMiniAppMention(String(appId).trim(), String(appName).trim()),
    )
}

export function stripMiniAppMarkup(text: string): string {
  return text
    .replace(MINIAPP_REMINDER_REGEX, '')
    .replace(MINIAPP_TAG_REGEX, (_, appName) => `@${String(appName).trim()}`)
    .replace(/\s+/g, ' ')
    .trim()
}
