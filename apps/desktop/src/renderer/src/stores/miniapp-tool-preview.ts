import { create } from 'zustand'
import type { MiniAppToolPreviewPhase } from '@superone/shared/miniapp-types'
import { withoutKey } from '@/lib/record'

export interface ToolUiPreviewEvent {
  kind: 'submit' | 'cancel' | 'close'
  payload?: unknown
  at: string
}

/**
 * One development tool UI rendered from fixture data. `miniapp_dev_preview`
 * replaces it wholesale; nothing here reaches the MiniApp Host, so an intercept
 * submit is recorded instead of running the tool.
 */
export interface ToolUiPreview {
  key: string
  appId: string
  appName: string
  projectDir: string
  projectId: string | null
  tool: string
  toolLabel: string
  phase: MiniAppToolPreviewPhase
  templatePath: string
  input: Record<string, unknown>
  result?: unknown
  running: boolean
  width?: number
  /** Bumped per show so the WebView remounts with the new fixture. */
  revision: number
  events: ToolUiPreviewEvent[]
}

export type ToolUiPreviewInput = Omit<ToolUiPreview, 'key' | 'revision' | 'events'>

export function toolUiPreviewKey(appId: string, projectDir: string): string {
  return `${appId}@${projectDir}`
}

/** The preview's dock panel id, which is also its host-layer slot key. */
export function toolUiPreviewSlotKey(previewKey: string): string {
  return `tool-ui-preview:${previewKey}`
}

const MAX_EVENTS = 20

interface ToolUiPreviewState {
  previews: Record<string, ToolUiPreview>
  show: (input: ToolUiPreviewInput) => ToolUiPreview
  record: (key: string, event: Omit<ToolUiPreviewEvent, 'at'>) => void
  remove: (key: string) => void
}

export const useToolUiPreviewStore = create<ToolUiPreviewState>((set, get) => ({
  previews: {},
  show: (input) => {
    const key = toolUiPreviewKey(input.appId, input.projectDir)
    const preview: ToolUiPreview = {
      ...input,
      key,
      revision: (get().previews[key]?.revision ?? 0) + 1,
      events: [],
    }
    set((s) => ({ previews: { ...s.previews, [key]: preview } }))
    return preview
  },
  record: (key, event) => set((s) => {
    const preview = s.previews[key]
    if (!preview) return s
    const events = [...preview.events, { ...event, at: new Date().toISOString() }].slice(-MAX_EVENTS)
    return { previews: { ...s.previews, [key]: { ...preview, events } } }
  }),
  remove: (key) => set((s) => ({ previews: withoutKey(s.previews, key) })),
}))
