import type { HarnessId } from '../session-types'

/**
 * What an environment can do, as it reports it — never inferred from version
 * strings. A client gates a feature on the RPC methods the environment
 * serves; absence means unsupported.
 */
export interface EnvironmentCapabilities {
  /** Every RPC method this environment serves. */
  methods: string[]
  /** Harness IDs this environment can host. */
  harnessIds: HarnessId[]
  /**
   * After cold node restart, Sessions remain usable and later turns may resume
   * from durable provider metadata when the Harness supports it.
   */
  coldSessionResume: boolean
  /** In-flight turn reattach across graceful node restart (provider-specific). */
  turnReattach: boolean
  /**
   * Host Action channel v1: durable poll/claim/respond for controller-side tools
   * (browser automation, computer use). Session-scoped grants (e.g. browser.read)
   * are stamped on session.create separately.
   */
  hostActionV1: boolean
}

/**
 * Whether the environment serves `method`; false while its capabilities are
 * unknown, and for a descriptor a release before method lists cached.
 */
export function servesMethod(capabilities: Partial<Pick<EnvironmentCapabilities, 'methods'>> | undefined, method: string): boolean {
  return capabilities?.methods?.includes(method) ?? false
}

/** This desktop's own environment: the window calls its host in-process, not by method. */
export const LOCAL_ENVIRONMENT_CAPABILITIES: EnvironmentCapabilities = {
  methods: [],
  harnessIds: ['claude', 'codex', 'acp', 'opencode'],
  coldSessionResume: true,
  turnReattach: false,
  hostActionV1: true,
}
