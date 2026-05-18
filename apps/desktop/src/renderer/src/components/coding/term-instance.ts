import type { TermInstance } from '@/stores/terminal'

export function disposeTermInstance(inst: TermInstance): void {
  try {
    inst.canvas?.dispose()
  } catch {
    /* canvas renderer already torn down */
  }
  inst.canvas = undefined
  inst.xterm.dispose()
}
