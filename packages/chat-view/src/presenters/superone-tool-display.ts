import type { ToolIcon } from './tool-display'

/**
 * The compact rows for SuperOne's own MCP tools — the ones whose whole UI is an
 * icon, a verb, and a short subject.
 *
 * This used to live inside the desktop `ToolBlockPresenter`, half as a lookup table
 * and half as a run of inline `if (mcpToolName === …)` branches. The phone reaches
 * tool rows through a different dispatcher and got none of it, so every tool here
 * arrived as a bare `plug` icon with no label — `tool-display.ts` answers
 * `{ icon: 'plug', summary: '' }` for anything starting with `mcp__`.
 *
 * Keeping the descriptor separate from the rendering is what lets both surfaces
 * share it: each one owns its own `ToolIcon` and `t`, and neither owns the table.
 */
export interface SuperoneToolDescriptor {
  icon: ToolIcon
  /** i18n keys, resolved by the caller — chat-view and desktop init i18next separately. */
  streamingKey: string
  actionKey: string
  doneKey: string
  /**
   * Subject line beside the label. Derived from the projected input, which is why
   * every field named here must survive `sanitizeRemoteToolInput`.
   */
  summary?: (params: Record<string, unknown>, result: string | null) => string
  /** i18n key for the subject a settled call shows when `summary` came back empty. */
  emptySummaryKey?: string
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** Paths are shown by their last segment: a phone row has no room for the rest. */
function basename(value: string): string {
  const cleaned = value.replace(/\s+/g, ' ').trim()
  return cleaned.includes('/') ? cleaned.split('/').pop() ?? cleaned : cleaned
}

function firstStringList(params: Record<string, unknown>, keys: readonly string[]): string[] {
  for (const key of keys) {
    const value = params[key]
    if (!Array.isArray(value)) continue
    const items = value.filter((item): item is string => typeof item === 'string' && item.length > 0)
    if (items.length > 0) return items
  }
  return []
}

export const SUPERONE_TOOL_DESCRIPTORS: Record<string, SuperoneToolDescriptor> = {
  config_read: {
    icon: 'book-open',
    streamingKey: 'chat.toolBlock.readingConfig',
    actionKey: 'chat.toolBlock.readSettings',
    doneKey: 'chat.toolBlock.readConfig',
    // The result names the domain in the user's own words; the input only has its id.
    summary: (params, result) => {
      if (result) {
        try {
          const parsed = JSON.parse(result) as { label?: unknown }
          if (typeof parsed?.label === 'string' && parsed.label) return parsed.label
        } catch { /* a truncated or non-JSON result just falls back to the input */ }
      }
      return str(params.domain)
    },
    // No domain means the agent asked for the overview rather than one section.
    emptySummaryKey: 'chat.toolBlock.guideOverview',
  },
  read_manual: {
    icon: 'book-open',
    streamingKey: 'chat.toolBlock.readingManual',
    actionKey: 'chat.toolBlock.readManualAction',
    doneKey: 'chat.toolBlock.readManual',
    summary: (params) => [str(params.domain), str(params.topic)].filter(Boolean).join('/'),
  },
  session_tag: {
    icon: 'clipboard-list',
    streamingKey: 'chat.toolBlock.archive.taggingSession',
    actionKey: 'chat.toolBlock.archive.tagSession',
    doneKey: 'chat.toolBlock.archive.sessionTagged',
    summary: (params) => {
      const tags = firstStringList(params, ['add', 'remove', 'set']).join(', ')
      const ids = Array.isArray(params.sessionIds) ? params.sessionIds.length : 0
      return [tags, ids > 1 ? String(ids) : ''].filter(Boolean).join(' · ')
    },
  },
  media_list_providers: {
    icon: 'image',
    streamingKey: 'chat.toolBlock.listingMediaProviders',
    actionKey: 'chat.toolBlock.listMediaProviders',
    doneKey: 'chat.toolBlock.listedMediaProviders',
  },
  miniapp_dev_register: {
    icon: 'package',
    streamingKey: 'chat.toolBlock.registeringMiniApp',
    actionKey: 'chat.toolBlock.registerMiniApp',
    doneKey: 'chat.toolBlock.registeredMiniApp',
    summary: (params) => basename(str(params.name) || str(params.directory) || str(params.appDir)),
  },
  miniapp_dev_update_types: {
    icon: 'wrench',
    streamingKey: 'chat.toolBlock.updatingMiniAppTypes',
    actionKey: 'chat.toolBlock.updateMiniAppTypes',
    doneKey: 'chat.toolBlock.updatedMiniAppTypes',
    summary: (params) => basename(str(params.appDir)),
  },
  widget_list_templates: {
    icon: 'canvas',
    streamingKey: 'chat.toolBlock.listingWidgetTemplates',
    actionKey: 'chat.toolBlock.listWidgetTemplates',
    doneKey: 'chat.toolBlock.listedWidgetTemplates',
  },
  media_video_status: {
    icon: 'image',
    streamingKey: 'chat.toolBlock.checkingVideoStatus',
    actionKey: 'chat.toolBlock.checkVideoStatus',
    doneKey: 'chat.toolBlock.checkVideoStatus',
  },
}

export function superoneToolDescriptor(mcpToolName: string): SuperoneToolDescriptor | null {
  return SUPERONE_TOOL_DESCRIPTORS[mcpToolName] ?? null
}
