/**
 * Read-only catalog of the official plugins bundled into SuperOne's dsh tree.
 *
 * Core plugins are mounted directly in `tree.ts` / `tool-plane.ts`. Agent-plane
 * plugins are discovered from the shipped preset compositions so this catalog
 * cannot silently drift when a preset gains or loses a row.
 */

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface BundledDshPlugin {
  /** Cordis module specifier, including an optional plugin subpath. */
  name: string
  /** Version carried by the desktop build. */
  version: string
  /** `core` or the ids of shipped agent presets that compose this plugin. */
  scopes: string[]
}

const DSH_VERSION = '0.1.1-rc.2'

const CORE_PLUGINS: readonly { name: string; version: string }[] = [
  { name: '@deepseek-ai/cordis-plugin-group', version: '1.0.1' },
  { name: '@deepseek-ai/cordis-plugin-loader', version: '1.0.2' },
  { name: '@deepseek-ai/cordis-plugin-timer', version: '1.1.3' },
  { name: '@deepseek-ai/dsh-agent', version: DSH_VERSION },
  { name: '@deepseek-ai/dsh-agent-loop', version: DSH_VERSION },
  { name: '@deepseek-ai/dsh-agent-presets', version: DSH_VERSION },
  { name: '@deepseek-ai/dsh-attachment-local', version: DSH_VERSION },
  { name: '@deepseek-ai/dsh-bash-sandbox', version: DSH_VERSION },
  { name: '@deepseek-ai/dsh-commands', version: DSH_VERSION },
  { name: '@deepseek-ai/dsh-cordis-host-runner', version: DSH_VERSION },
  { name: '@deepseek-ai/dsh-fs-sandbox', version: DSH_VERSION },
  { name: '@deepseek-ai/dsh-goal', version: DSH_VERSION },
  { name: '@deepseek-ai/dsh-goal-round-driver', version: DSH_VERSION },
  { name: '@deepseek-ai/dsh-jobs-local', version: DSH_VERSION },
  { name: '@deepseek-ai/dsh-llm', version: DSH_VERSION },
  { name: '@deepseek-ai/dsh-llm-deepseek', version: DSH_VERSION },
  { name: '@deepseek-ai/dsh-permission-presets', version: DSH_VERSION },
  { name: '@deepseek-ai/dsh-sandbox-local', version: DSH_VERSION },
  { name: '@deepseek-ai/dsh-sandbox-policy', version: DSH_VERSION },
  { name: '@deepseek-ai/dsh-session', version: DSH_VERSION },
  { name: '@deepseek-ai/dsh-session-checkpoint-policy', version: DSH_VERSION },
  { name: '@deepseek-ai/dsh-session-persistence-jsonl', version: DSH_VERSION },
  { name: '@deepseek-ai/dsh-shell-env', version: DSH_VERSION },
  { name: '@deepseek-ai/dsh-skill', version: DSH_VERSION },
  { name: '@deepseek-ai/dsh-subagent', version: DSH_VERSION },
  { name: '@deepseek-ai/dsh-subagent-fork-in-process', version: DSH_VERSION },
  { name: '@deepseek-ai/dsh-subagent-spawn-in-process', version: DSH_VERSION },
  { name: '@deepseek-ai/dsh-subprocess-local', version: DSH_VERSION },
  { name: '@deepseek-ai/dsh-system-prompt', version: DSH_VERSION },
  { name: '@deepseek-ai/dsh-token-meter', version: DSH_VERSION },
  { name: '@deepseek-ai/dsh-tool-subagent-report', version: DSH_VERSION },
  { name: '@deepseek-ai/dsh-tools', version: DSH_VERSION },
  { name: '@deepseek-ai/dsh-user-approval', version: DSH_VERSION },
  { name: '@deepseek-ai/dsh-user-questions', version: DSH_VERSION },
  { name: '@deepseek-ai/dsh-web', version: DSH_VERSION },
  { name: '@deepseek-ai/dsh-web-search-deepseek', version: DSH_VERSION },
]

const PLUGIN_NAME = /^\s*name:\s*['"]?(@deepseek-ai\/(?:dsh|cordis-plugin)-[a-z0-9-]+(?:\/[a-z0-9-]+)?)/gm

/**
 * List official plugins available to the embedded runtime.
 *
 * An unavailable preset root is non-fatal: core plugins are compiled into the
 * app and remain useful diagnostics even if packaged resources are damaged.
 */
export async function listBundledDshPlugins(presetRoot: string): Promise<BundledDshPlugin[]> {
  const catalog = new Map<string, BundledDshPlugin>(
    CORE_PLUGINS.map((plugin) => [plugin.name, { ...plugin, scopes: ['core'] }]),
  )

  const presetDirectories = await readdir(presetRoot, { withFileTypes: true }).catch(() => [])
  await Promise.all(
    presetDirectories
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const source = await readFile(join(presetRoot, entry.name, 'agent.cordis.yml'), 'utf8').catch(
          () => '',
        )
        for (const match of source.matchAll(PLUGIN_NAME)) {
          const name = match[1]!
          const plugin = catalog.get(name)
          if (plugin) {
            if (!plugin.scopes.includes(entry.name)) plugin.scopes.push(entry.name)
          } else {
            catalog.set(name, { name, version: DSH_VERSION, scopes: [entry.name] })
          }
        }
      }),
  )

  return [...catalog.values()]
    .map((plugin) => ({ ...plugin, scopes: [...plugin.scopes].sort() }))
    .sort((a, b) => a.name.localeCompare(b.name))
}
