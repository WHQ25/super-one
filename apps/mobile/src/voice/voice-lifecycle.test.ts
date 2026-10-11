import { expect, it, vi } from 'vitest'
import { bindVoiceLifecycle } from './voice-lifecycle'

it('reports background separately from disposal and does not resume on foreground', () => {
  let state = (_: string) => {}
  const remove = vi.fn(); const background = vi.fn(); const stop = vi.fn()
  const dispose = bindVoiceLifecycle({ addEventListener: (_, fn) => { state = fn; return { remove } } }, background, stop)
  state('inactive'); state('active'); expect(background).not.toHaveBeenCalled()
  state('background'); expect(background).toHaveBeenCalledTimes(1); expect(stop).not.toHaveBeenCalled()
  state('active'); expect(background).toHaveBeenCalledTimes(1)
  dispose(); expect(remove).toHaveBeenCalledTimes(1); expect(stop).toHaveBeenCalledTimes(1)
})
