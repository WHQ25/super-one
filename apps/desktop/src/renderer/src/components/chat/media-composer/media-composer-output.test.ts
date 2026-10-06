/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { MediaComposerResult } from '@superone/shared/media-composer'
import { PNG_ATTACHMENT } from '@superone/shared/test-fixtures/attachments'
import { createDefaultPerSessionState, createDefaultProjectState, useChatStore } from '@/stores/chat'
import { buildMediaDelegationText, delegateMediaToAgent, insertMediaIntoDraft, sendMediaToAgent } from './media-composer-output'

const previous = useChatStore.getState()
const owner = { projectPath: '/media-output', sessionId: 'first' }
const sibling = { ...owner, sessionId: 'second' }
const image: MediaComposerResult = { generationId: 'image', kind: 'image', status: 'succeeded', files: [{ path: '/image.png', agentPath: '/image.png', mediaType: PNG_ATTACHMENT.mimeType, base64: PNG_ATTACHMENT.base64 }] }
const send = vi.fn()
beforeEach(() => {
  send.mockReset().mockResolvedValue(undefined)
  const doc = { type: 'doc', content: [{ type: 'paragraph', content: [
    { type: 'text', text: 'Review ' }, { type: 'mention', attrs: { kind: 'file', value: 'README.md', displayName: 'README' } },
    { type: 'pasteChip', attrs: { text: 'pasted text' } },
  ] }] }
  useChatStore.setState({ activeProject: owner.projectPath, sendMessage: send, projectSessions: {
    [owner.projectPath]: { ...createDefaultProjectState(), _activeSessionId: sibling.sessionId, _sessions: {
      [owner.sessionId]: { ...createDefaultPerSessionState(), draftText: 'Review README pasted text', draftJson: doc },
      [sibling.sessionId]: { ...createDefaultPerSessionState(), draftText: 'Sibling draft' },
    } },
  } })
})
afterEach(() => useChatStore.setState(previous))
it('inserts images into the captured owner and preserves its rich draft, with idempotent retry', async () => {
  const doc = useChatStore.getState().projectSessions[owner.projectPath]._sessions[owner.sessionId].draftJson
  await insertMediaIntoDraft(owner, image); await insertMediaIntoDraft(owner, image)
  const sessions = useChatStore.getState().projectSessions[owner.projectPath]._sessions
  expect(sessions.first.attachments).toHaveLength(1)
  expect((sessions.first.draftJson as { content: object[] }).content[0]).toEqual((doc as { content: object[] }).content[0])
  expect(sessions.second.draftText).toBe('Sibling draft'); expect(sessions.second.attachments).toHaveLength(0)
})
it('uses the ordinary send path with rich segments, file mentions and the exact target', async () => {
  await sendMediaToAgent(owner, image)
  expect(send).toHaveBeenCalledWith(expect.stringContaining('<superone-ref>'),
    expect.arrayContaining([{ text: 'pasted text', isPaste: true }, { attachmentId: 'media-image-0' }]),
    [expect.objectContaining({ kind: 'file', value: 'README.md' })], [expect.objectContaining({ id: 'media-image-0' })], owner)
  expect(useChatStore.getState().projectSessions[owner.projectPath]._sessions.first.draftText).toBe('')
})
it('leaves inserted results and the draft available if send admission fails', async () => {
  send.mockRejectedValue(new Error('not connected'))
  await expect(sendMediaToAgent(owner, image)).rejects.toThrow('not connected')
  expect(useChatStore.getState().projectSessions[owner.projectPath]._sessions.first.attachments).toHaveLength(1)
  expect(useChatStore.getState().projectSessions[owner.projectPath]._sessions.first.draftText).toContain('Review')
})
it('does not erase edits made while the send is awaiting acknowledgement', async () => {
  send.mockImplementation(async () => useChatStore.getState().setDraftText('Newer draft', owner))
  await sendMediaToAgent(owner, image)
  expect(useChatStore.getState().projectSessions[owner.projectPath]._sessions.first.draftText).toBe('Newer draft')
})
it('requires completed remote delivery before inserting a video for the remote agent', async () => {
  const remote = { ...owner, projectPath: 'remote:node:/repo' }
  const video: MediaComposerResult = { generationId: 'video', kind: 'video', status: 'succeeded', files: [{ path: '/host/video.mp4', agentPath: '/host/video.mp4', mediaType: 'video/mp4' }] }
  await expect(insertMediaIntoDraft(remote, video)).rejects.toThrow('remoteVideoUnavailable')
  expect(send).not.toHaveBeenCalled()
})

const model = { providerId: 'ark-key', providerLabel: 'Ark', model: 'seedance', label: 'Seedance' }
const reference = (name: string, role: 'reference' | 'first' | 'last') => ({ name, mediaType: PNG_ATTACHMENT.mimeType, base64: PNG_ATTACHMENT.base64, role })
it('describes a delegated video with tool argument names and numbered attachment roles', () => {
  expect(buildMediaDelegationText({ kind: 'video', model, prompt: ' A fox in snow ', aspectRatio: '9:16', duration: 8, resolution: '',
    references: [reference('style.png', 'reference'), reference('start.png', 'first'), reference('pose.png', 'reference')] })).toBe([
    'Generate a video with the media_generate_video tool.', '', 'Prompt:', 'A fox in snow', '', 'Settings:',
    '- provider: ark-key (Ark)', '- model: seedance (Seedance)', '- aspect_ratio: 9:16', '- duration: 8',
    '- first_frame_path: attached image 2', '- reference_image_paths: attached images 1, 3',
  ].join('\n'))
})
it('sends a delegated request as its own message and keeps the draft', async () => {
  await delegateMediaToAgent(owner, { kind: 'image', model, prompt: 'A cabin', references: [reference('ref.png', 'reference')], size: '2K' })
  const [text, segments, mentions, attachments, target] = send.mock.calls[0]!
  expect(text).toContain('- size: 2K')
  expect(segments).toEqual([{ text, isPaste: false }, { attachmentId: attachments[0].id }])
  expect(mentions).toEqual([])
  expect(attachments).toHaveLength(1)
  expect(target).toBe(owner)
  expect(useChatStore.getState().projectSessions[owner.projectPath]._sessions.first.draftText).toBe('Review README pasted text')
})
