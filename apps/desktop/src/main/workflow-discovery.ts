import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  extractWorkflowScriptHints,
  type WorkflowArgSpec,
} from '@superone/shared/workflow-args'

export interface DiscoveredWorkflow {
  name: string
  description: string
  whenToUse?: string
  source: 'project' | 'user'
  path: string
  args: WorkflowArgSpec[]
  exampleJson?: string
}

function parseMetaNameDescription(script: string): { name?: string; description?: string } {
  const name = script.match(/name\s*:\s*"((?:\\.|[^"\\])*)"/)?.[1]
  const description = script.match(/description\s*:\s*"((?:\\.|[^"\\])*)"/)?.[1]
  return {
    name: name?.replace(/\\"/g, '"'),
    description: description?.replace(/\\"/g, '"'),
  }
}

async function scanDir(
  dir: string,
  source: 'project' | 'user',
): Promise<DiscoveredWorkflow[]> {
  let files: string[]
  try {
    files = await readdir(dir)
  } catch {
    return []
  }
  const out: DiscoveredWorkflow[] = []
  for (const file of files) {
    if (!file.endsWith('.rhai')) continue
    const path = join(dir, file)
    let script: string
    try {
      script = await readFile(path, 'utf8')
    } catch {
      continue
    }
    const meta = parseMetaNameDescription(script)
    const hints = extractWorkflowScriptHints(script)
    const name = (meta.name || file.replace(/\.rhai$/, '')).trim()
    if (!name) continue
    out.push({
      name,
      description: meta.description || '',
      whenToUse: hints.whenToUse,
      source,
      path,
      args: hints.args,
      exampleJson: hints.exampleJson,
    })
  }
  return out
}

/**
 * Scan project + user `.grok/workflows/*.rhai` and parse supported `args` fields.
 * Does not depend on ACP available_commands meta (which often omits path).
 */
export async function discoverGrokWorkflows(projectPath?: string | null): Promise<DiscoveredWorkflow[]> {
  const dirs: Array<{ dir: string; source: 'project' | 'user' }> = []
  if (projectPath && projectPath.trim()) {
    dirs.push({ dir: join(projectPath, '.grok', 'workflows'), source: 'project' })
  }
  dirs.push({ dir: join(homedir(), '.grok', 'workflows'), source: 'user' })

  const byName = new Map<string, DiscoveredWorkflow>()
  // Project wins over user on name collision (same as Grok registry).
  for (const { dir, source } of dirs) {
    const entries = await scanDir(dir, source)
    for (const e of entries) {
      if (source === 'project' || !byName.has(e.name)) {
        byName.set(e.name, e)
      }
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}
