import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '@superone/shared/agent-types'
import { projectWindowMessage } from '@superone/runtime/stream/delivery/window-projection'
import { MAX_FRAGMENT_BYTES } from '@superone/shared/transcript-window/fragment-message'
import { DEFAULT_WINDOW_BUDGET, selectTranscriptWindow } from '@superone/shared/transcript-window/select-window'
import { windowSource } from '@superone/shared/transcript-window/window-fixtures'
import { applyWindowResult, EMPTY_WINDOW_LOOKUP, materializeWindowMessage } from '@superone/shared/transcript-window/window-store'
import { groupContent } from './chat-message/groupContent'
import { collectGeneratedImages, collectGeneratedVideos, isHiddenToolBlock } from './tool-display'

describe('native gallery through a remote transcript window', () => {
  it.each(['claude', 'codex', 'grok-build'])('keeps the %s gallery when its input contains a 42 KB image', (providerId) => {
    const input = JSON.stringify({ title: 'Screenshot', template: '@native/image-gallery', data: {
      images: [{ base64: 'a'.repeat(56_604), mediaType: 'image/png' }],
    } })
    const savedPath = '/node/sync/s1/media-gen/screenshot.png'
    const summary = JSON.stringify({ kind: 'native', nativeType: 'image-gallery', title: 'Screenshot', images: [
      { id: 'image-0', type: 'image_generation', status: 'completed', savedPath },
    ] })
    const source: ChatMessage = { id: 'm', role: 'assistant', status: 'complete', providerId, createdAt: '', content: [
      { type: 'tool_use', toolUseId: 'nested-widget', toolName: 'mcp__superone__widget_show', input, status: 'complete', parentToolUseId: null },
      { type: 'tool_result', toolUseId: 'nested-widget', summary, parentToolUseId: null },
    ] }
    // Code-mode extraction already produces this canonical call/result pair.
    const projected = projectWindowMessage(source)
    const result = selectTranscriptWindow(windowSource([projected]), {}, DEFAULT_WINDOW_BUDGET)
    const { state } = applyWindowResult(null, { ...result, total: 1 }, EMPTY_WINDOW_LOOKUP)
    const restored = materializeWindowMessage(state.messages[0])
    const grouped = groupContent(restored.content, [])
    expect(collectGeneratedImages(restored.content, grouped.toolResultMap).map(item => item.savedPath)).toEqual([savedPath])
    expect(collectGeneratedVideos(restored.content, grouped.toolResultMap)).toEqual([])
    expect(restored.content.some(block => block.type === 'notice' && block.kind === 'omitted')).toBe(false)
    expect(result.messages[0].fragments.every(fragment => Buffer.byteLength(JSON.stringify(fragment.body)) <= MAX_FRAGMENT_BYTES)).toBe(true)
    expect(isHiddenToolBlock('mcp__superone__widget_show', grouped.toolResultMap.get('nested-widget'))).toBe(true)
    expect(source.content[0]).toMatchObject({ input })
  })
})
