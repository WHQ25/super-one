import { createContext, useContext } from 'react'

export interface NestedToolDefaults {
  defaultAutoExpand?: boolean
}

export const NestedToolContext = createContext<NestedToolDefaults | null>(null)

export function useNestedToolDefaults(): NestedToolDefaults | null {
  return useContext(NestedToolContext)
}
