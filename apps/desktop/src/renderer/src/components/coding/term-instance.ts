import type { TermInstance } from '@/stores/terminal'

export function disposeTermInstance(inst: TermInstance): void {
  try {
    inst.webgl?.dispose()
  } catch {
    /* webgl renderer already torn down (context lost) */
  }
  inst.webgl = undefined
  inst.xterm.dispose()
}
