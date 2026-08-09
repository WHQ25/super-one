import type { WorkflowArgSpec } from '@superone/shared/workflow-args'

/** Session-local cache so send-time rewrite can type-coerce CLI args. */
const cache = new Map<string, WorkflowArgSpec[]>()

export function setWorkflowArgSpecs(name: string, specs: WorkflowArgSpec[]): void {
  cache.set(name, specs)
}

export function getWorkflowArgSpecs(name: string): WorkflowArgSpec[] {
  return cache.get(name) ?? []
}
