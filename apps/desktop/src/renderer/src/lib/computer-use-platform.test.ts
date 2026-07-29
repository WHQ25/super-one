import { describe, expect, it } from 'vitest'
import { isComputerUseSupportedPlatform } from './computer-use-platform'

describe('isComputerUseSupportedPlatform', () => {
  it('exposes Computer Use only on macOS', () => {
    expect(isComputerUseSupportedPlatform('darwin')).toBe(true)
    expect(isComputerUseSupportedPlatform('win32')).toBe(false)
    expect(isComputerUseSupportedPlatform('linux')).toBe(false)
  })
})
