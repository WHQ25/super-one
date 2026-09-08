import { createContext } from 'react'

/** Paint progress is independent of the host's actual turn/tool lifecycle. */
export const TextRevealContext = createContext({ active: false, reasoning: false, paced: false })
