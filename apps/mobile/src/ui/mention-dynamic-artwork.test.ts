import { afterEach, describe, expect, it } from 'vitest'
import { clearDynamicMentionArtworkForTests, dynamicMentionArtwork, dynamicMentionArtworkRevision, dynamicMentionArtworkSnapshot, rememberMentionArtwork } from './mention-dynamic-artwork'

describe('dynamic mention artwork', () => {
  afterEach(clearDynamicMentionArtworkForTests)
  it('indexes selected app artwork by its stable mention identity', () => {
    rememberMentionArtwork({ kind: 'miniapp', path: 'board', label: 'Board', iconPng: 'AAAA' })
    expect(dynamicMentionArtwork('miniapp', 'board')).toBe('AAAA')
    expect(dynamicMentionArtwork('desktop-app', 'board')).toBeUndefined()
  })
  it('does not replace cached artwork with a generic result', () => {
    const before = dynamicMentionArtworkRevision()
    rememberMentionArtwork({ kind: 'desktop-app', path: 'com.example.Editor', iconPng: 'BBBB' })
    const added = dynamicMentionArtworkRevision()
    rememberMentionArtwork({ kind: 'desktop-app', path: 'com.example.Editor' })
    expect(dynamicMentionArtwork('desktop-app', 'com.example.Editor')).toBe('BBBB')
    expect(dynamicMentionArtworkSnapshot()).toEqual({ 'desktop-app:com.example.Editor': 'BBBB' })
    expect(added).toBe(before + 1)
    expect(dynamicMentionArtworkRevision()).toBe(added)
  })
})
