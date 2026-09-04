import { describe, expect, it } from 'vitest'
import { classifyAttachmentSize, decodedBase64ByteLength } from './attachment-limits'

describe('attachment byte limits', () => {
  it('calculates padded, unpadded, data URL, and whitespace base64 sizes', () => {
    expect(decodedBase64ByteLength('AA==')).toBe(1)
    expect(decodedBase64ByteLength('AAA=')).toBe(2)
    expect(decodedBase64ByteLength('AAAA')).toBe(3)
    expect(decodedBase64ByteLength('data:image/png;base64,AA==')).toBe(1)
    expect(decodedBase64ByteLength('AA==\n')).toBe(1)
  })

  it('fails closed on malformed data and either declared or decoded overflow', () => {
    expect(classifyAttachmentSize('A', undefined, 1)).toBe('invalid')
    expect(classifyAttachmentSize('A=', undefined, 1)).toBe('invalid')
    expect(classifyAttachmentSize('==', undefined, 1)).toBe('invalid')
    expect(classifyAttachmentSize('data:image/png,AA==', undefined, 1)).toBe('invalid')
    expect(classifyAttachmentSize('AA==', 2, 1)).toBe('too-large')
    expect(classifyAttachmentSize('AAAA', undefined, 2)).toBe('too-large')
    expect(classifyAttachmentSize('AAA=', undefined, 2)).toBe('valid')
  })
})
