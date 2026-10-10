import { expect, it, vi } from 'vitest'
import { bindVoiceLifecycle } from './voice-lifecycle'

it('ignores permission-sheet inactive and foreground; ends on background/lock and final unmount', () => {
  let state = (_: string) => {}
  const remove = vi.fn(); const stop = vi.fn()
  const dispose = bindVoiceLifecycle({ addEventListener: (_, fn) => { state = fn; return { remove } } }, stop)
  state('inactive'); state('active'); expect(stop).not.toHaveBeenCalled()
  state('background'); expect(stop).toHaveBeenCalledTimes(1)
  state('active'); expect(stop).toHaveBeenCalledTimes(1)
  dispose(); expect(remove).toHaveBeenCalledTimes(1); expect(stop).toHaveBeenCalledTimes(2)
})
