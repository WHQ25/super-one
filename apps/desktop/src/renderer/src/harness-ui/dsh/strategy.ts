import { neutralSelection } from '../neutral-selection'
import type { HarnessStrategy } from '../strategy'

/** dsh's model control fills its own default once its catalog is known. */
export const dshStrategy: HarnessStrategy = {
  selection: neutralSelection,
  seed: () => {},
  missingDefaults: () => ({}),
  prewarmHint: (session) => ({ model: session.selectedModel || undefined }),
}
