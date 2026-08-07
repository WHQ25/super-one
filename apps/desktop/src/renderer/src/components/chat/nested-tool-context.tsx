import { createContext, useContext } from 'react'

export interface NestedToolDefaults {
  /** When false, tools start collapsed (and stay so unless user expands — if allowed). */
  defaultAutoExpand?: boolean
  /**
   * When false, tool rows are header-only (no expand chevron / body).
   * Used inside SubagentBlock cards; SubagentFullView leaves this true so details can open.
   */
  allowExpand?: boolean
}

export const NestedToolContext = createContext<NestedToolDefaults | null>(null)

export function useNestedToolDefaults(): NestedToolDefaults | null {
  return useContext(NestedToolContext)
}
