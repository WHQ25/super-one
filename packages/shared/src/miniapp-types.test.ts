import { describe, it, expect } from 'vitest'
import { parseInChatResult } from './miniapp-types'

describe('parseInChatResult', () => {
  it('should parse valid in-chat result', () => {
    const json = JSON.stringify({ __inchat: true, appId: 'abc', data: { title: 'Hello' } })
    const result = parseInChatResult(json)
    expect(result).toEqual({ __inchat: true, appId: 'abc', data: { title: 'Hello' } })
  })

  it('should return null for non-inchat JSON', () => {
    expect(parseInChatResult(JSON.stringify({ foo: 'bar' }))).toBeNull()
  })

  it('should return null for invalid JSON', () => {
    expect(parseInChatResult('not json')).toBeNull()
  })

  it('should return null for missing appId', () => {
    expect(parseInChatResult(JSON.stringify({ __inchat: true, data: {} }))).toBeNull()
  })

  it('should return null for missing data', () => {
    expect(parseInChatResult(JSON.stringify({ __inchat: true, appId: 'abc' }))).toBeNull()
  })

  it('should return null for __inchat !== true', () => {
    expect(parseInChatResult(JSON.stringify({ __inchat: false, appId: 'abc', data: {} }))).toBeNull()
  })
})
