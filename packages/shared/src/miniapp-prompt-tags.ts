import { wrapMiniAppMention } from './miniapp-mention-marker'
import { replaceCapabilityTagsWithMention, stripCapabilityMarkup } from './capability-prompt-tags'

export const MINIAPP_TAG_REGEX = /<superone-miniapp>\s*<appname>([\s\S]*?)<\/appname>\s*<appid>([\s\S]*?)<\/appid>\s*<\/superone-miniapp>/g
export const MINIAPP_REMINDER_REGEX = /\n*<superone-miniapp-reminder>[\s\S]*?<\/superone-miniapp-reminder>\n*/g

export const SESSION_TAG_REGEX =
  /<superone-session>\s*<title>([\s\S]*?)<\/title>\s*<sessionId>([\s\S]*?)<\/sessionId>\s*<\/superone-session>/g
export const SESSION_REMINDER_REGEX =
  /\n*<superone-session-reminder>[\s\S]*?<\/superone-session-reminder>\n*/g

export const DESKTOP_APP_TAG_REGEX =
  /<superone-desktop-app>\s*<name>([\s\S]*?)<\/name>\s*<bundleId>([\s\S]*?)<\/bundleId>\s*<\/superone-desktop-app>/g
export const DESKTOP_APP_REMINDER_REGEX =
  /\n*<superone-desktop-app-reminder>[\s\S]*?<\/superone-desktop-app-reminder>\n*/g

/** Replace agent-facing structured tags with user-visible @labels (keeps surrounding whitespace/newlines). */
export function replaceMiniAppTagsWithMention(text: string): string {
  // Chain every structured @-mention family so copy paths stay user-visible.
  return replaceCapabilityTagsWithMention(
    text
      .replace(MINIAPP_REMINDER_REGEX, '')
      .replace(SESSION_REMINDER_REGEX, '')
      .replace(DESKTOP_APP_REMINDER_REGEX, '')
      .replace(MINIAPP_TAG_REGEX, (_, appName, appId) =>
        wrapMiniAppMention(String(appId).trim(), String(appName).trim()),
      )
      .replace(SESSION_TAG_REGEX, (_, title) => `@${String(title).trim()}`)
      .replace(DESKTOP_APP_TAG_REGEX, (_, name) => `@${String(name).trim()}`),
  )
}

/** Collapse agent-facing markup into plain @labels for titles / sidebar names. */
export function stripMiniAppMarkup(text: string): string {
  // Chain capability strip last so titles hide all markup families and whitespace collapses once.
  return stripCapabilityMarkup(
    text
      .replace(MINIAPP_REMINDER_REGEX, '')
      .replace(SESSION_REMINDER_REGEX, '')
      .replace(DESKTOP_APP_REMINDER_REGEX, '')
      .replace(MINIAPP_TAG_REGEX, (_, appName) => `@${String(appName).trim()}`)
      .replace(SESSION_TAG_REGEX, (_, title) => `@${String(title).trim()}`)
      .replace(DESKTOP_APP_TAG_REGEX, (_, name) => `@${String(name).trim()}`),
  )
}
