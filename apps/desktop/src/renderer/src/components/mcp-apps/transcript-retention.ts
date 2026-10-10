import { createContext } from 'react'

/** A virtual transcript owns its encountered Views until the transcript closes. */
export const McpAppTranscriptRetention = createContext<symbol | null>(null)
