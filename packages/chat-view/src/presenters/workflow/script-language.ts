import type { WorkflowScriptLanguage } from './types'

export function looksLikeRhaiWorkflow(script: string): boolean {
  if (!script) return false
  if (/#\{/.test(script)) return true
  if (/\blet\s+meta\s*=/.test(script) && !/\bexport\s+const\s+meta\b/.test(script)) return true
  if (/\bfn\s+\w+\s*\(/.test(script) && /\bphase\s*\(/.test(script)) return true
  return false
}

export function looksLikePythonWorkflow(script: string): boolean {
  if (!script) return false
  if (looksLikeRhaiWorkflow(script)) return false
  if (/\bexport\s+const\s+meta\b/.test(script)) return false
  if (/^\s*(?:async\s+)?def\s+\w+\s*\(/m.test(script)) return true
  if (/\blambda\s+[^:\n]+:/m.test(script)) return true
  if (/\bf(['"])/.test(script)) return true
  if (/^\s*(?:from\s+\S+\s+import\s+|import\s+\w+)/m.test(script) && !/;\s*$/m.test(script)) return true
  if (/^\s*for\s+\w+\s+in\s+.+:\s*$/m.test(script)) return true
  if (
    /\bawait\s+parallel\s*\(/.test(script)
    && !/=>/.test(script)
    && !/\b(?:const|let|var)\s+\w+\s*=/.test(script)
  ) {
    return true
  }
  if (
    /\bphase\s*\(/.test(script)
    && !/\b(?:const|let|var|function|export)\b/.test(script)
    && !/=>/.test(script)
    && !/;\s*$/m.test(script)
    && !/\{\s*[A-Za-z_$][\w$]*\s*:/.test(script)
  ) {
    return true
  }
  return false
}

export function detectWorkflowScriptLanguage(
  code?: string,
  path?: string,
  fallback: WorkflowScriptLanguage = 'javascript',
): WorkflowScriptLanguage {
  const lowerPath = path?.trim().toLowerCase()
  if (lowerPath?.endsWith('.rhai')) return 'rhai'
  if (lowerPath?.endsWith('.py')) return 'python'
  if (lowerPath?.endsWith('.js') || lowerPath?.endsWith('.mjs') || lowerPath?.endsWith('.ts')) {
    return 'javascript'
  }
  if (code) {
    if (looksLikeRhaiWorkflow(code)) return 'rhai'
    if (looksLikePythonWorkflow(code)) return 'python'
  }
  return fallback
}
