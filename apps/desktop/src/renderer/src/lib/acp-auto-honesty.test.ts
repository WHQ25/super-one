import { describe, expect, it, vi } from 'vitest'
import { noteAcpAutoFailClosed, resetAcpAutoFailClosedToastForTests } from './acp-auto-honesty'

describe('noteAcpAutoFailClosed', () => {
  it('toasts once then stays quiet', () => {
    resetAcpAutoFailClosedToastForTests()
    const show = vi.fn()
    noteAcpAutoFailClosed(show, 'fail closed')
    noteAcpAutoFailClosed(show, 'fail closed')
    expect(show).toHaveBeenCalledTimes(1)
    expect(show).toHaveBeenCalledWith('fail closed')
  })
})
