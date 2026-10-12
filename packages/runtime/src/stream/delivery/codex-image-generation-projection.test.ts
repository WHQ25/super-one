import { describe, expect, it } from 'vitest'
import type { ChatMessage, ImageGenerationItem } from '@superone/shared/agent-types'
import { codexItemsToContent } from '@superone/shared/codex-content'
import { projectProgressiveMessage } from './projection'
import { stripMessagesForRemote } from './remote-content'

const generation: ImageGenerationItem = { id: 'img', type: 'image_generation', status: 'completed', savedPath: '/tmp/generated.png', revisedPrompt: 'A cat' }
const message: ChatMessage = { id: 'm', role: 'assistant', status: 'complete', createdAt: '', providerId: 'codex',
  content: codexItemsToContent([generation]), metadata: { codex: { threadId: 't', usage: null, items: [] } } }

describe('a Codex image generation sent to a remote client', () => {
  it.each([
    ['summary', (messages: ChatMessage[]) => messages.map(projectProgressiveMessage)],
    ['full', stripMessagesForRemote],
  ])('keeps the input its gallery reads in the %s projection', (_, project) => {
    const [tool] = project([message])[0]!.content
    expect(tool).toMatchObject({ toolName: 'ImageGeneration' })
    expect(tool && 'input' in tool && JSON.parse(tool.input as string)).toMatchObject({ status: 'completed', savedPath: '/tmp/generated.png' })
  })
})
