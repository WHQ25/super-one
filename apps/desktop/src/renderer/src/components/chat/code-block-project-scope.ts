import { createContext, useContext } from 'react'

const CodeProjectContext = createContext<string | null>(null)
export const CodeBlockProjectScope = CodeProjectContext.Provider
export const useCodeBlockProject = () => useContext(CodeProjectContext)
