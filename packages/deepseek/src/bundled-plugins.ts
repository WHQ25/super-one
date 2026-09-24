/**
 * Read-only catalog of the official plugins bundled into SuperOne's dsh tree.
 *
 * Core plugins are mounted directly in `tree.ts` / `tool-plane.ts`. Agent-plane
 * plugins are discovered from the shipped preset compositions so this catalog
 * cannot silently drift when a preset gains or loses a row.
 */

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { AGENT_PRESET_PLUGIN } from './presets'

export interface BundledDshPlugin {
  /** Cordis module specifier, including an optional plugin subpath. */
  name: string
  /** Version carried by the desktop build. */
  version: string
  /** `core` or the ids of shipped agent presets that compose this plugin. */
  scopes: string[]
}

const DSH_VERSION = '0.1.7-rc.1'

const CORE_PLUGINS: readonly { name: string; version: string }[] = [
  { name: '@deepseek-ai/cordis-plugin-group', version: '1.0.4' },
  { name: '@deepseek-ai/cordis-plugin-loader', version: '1.0.5' },
  { name: '@deepseek-ai/cordis-plugin-timer', version: '1.1.6' },
  { name: '@deepseek-ai/dsh-agent', version: DSH_VERSION },
  { name: '@deepseek-ai/dsh-agent-loop', version: DSH_VERSION },
  { name: '@deepseek-ai/dsh-agent-preset-registry', version: DSH_VERSION },
  { name: '@deepseek-ai/dsh-attachment-local', version: DSH_VERSION },
  { name: '@deepseek-ai/dsh-bash-sandbox', version: DSH_VERSION },
  { name: '@deepseek-ai/dsh-compaction-image-offload', version: DSH_VERSION },
  { name: '@deepseek-ai/dsh-commands', version: DSH_VERSION },
  { name: '@deepseek-ai/dsh-cordis-host-runner', version: DSH_VERSION },
  { name: '@deepseek-ai/dsh-fs-sandbox', version: DSH_VERSION },
  { name: '@deepseek-ai/dsh-goal', version: DSH_VERSION },
  { name: '@deepseek-ai/dsh-goal-round-driver', version: DSH_VERSION },
  { name: '@deepseek-ai/dsh-jobs-local', version: DSH_VERSION },
  { name: '@deepseek-ai/dsh-llm', version: DSH_VERSION },
  { name: '@deepseek-ai/dsh-llm-deepseek', version: DSH_VERSION },
  { name: '@deepseek-ai/dsh-llm-retry', version: DSH_VERSION },
  { name: '@deepseek-ai/dsh-mcp-resources', version: DSH_VERSION },
  { name: '@deepseek-ai/dsh-permission-presets', version: DSH_VERSION },
  { name: '@deepseek-ai/dsh-ptc-runtime-node', version: DSH_VERSION },
  { name: '@deepseek-ai/dsh-sandbox-local', version: DSH_VERSION },
  { name: '@deepseek-ai/dsh-sandbox-policy', version: DSH_VERSION },
  { name: '@deepseek-ai/dsh-session', version: DSH_VERSION },
  { name: '@deepseek-ai/dsh-session-checkpoint-policy', version: DSH_VERSION },
  { name: '@deepseek-ai/dsh-session-persistence-jsonl', version: DSH_VERSION },
  { name: '@deepseek-ai/dsh-session-projection', version: DSH_VERSION },
  { name: '@deepseek-ai/dsh-shell-env', version: DSH_VERSION },
  { name: '@deepseek-ai/dsh-skill', version: DSH_VERSION },
  { name: '@deepseek-ai/dsh-subagent', version: DSH_VERSION },
  { name: '@deepseek-ai/dsh-subagent-fork-in-process', version: DSH_VERSION },
  { name: '@deepseek-ai/dsh-subagent-spawn-in-process', version: DSH_VERSION },
  { name: '@deepseek-ai/dsh-subprocess-local', version: DSH_VERSION },
  { name: '@deepseek-ai/dsh-system-prompt', version: DSH_VERSION },
  { name: '@deepseek-ai/dsh-token-meter', version: DSH_VERSION },
  { name: '@deepseek-ai/dsh-tool-cordis/host', version: DSH_VERSION },
  { name: '@deepseek-ai/dsh-tool-subagent/model-selection-settings', version: DSH_VERSION },
  { name: '@deepseek-ai/dsh-tools', version: DSH_VERSION },
  { name: '@deepseek-ai/dsh-user-approval', version: DSH_VERSION },
  { name: '@deepseek-ai/dsh-user-questions', version: DSH_VERSION },
  { name: '@deepseek-ai/dsh-workspace-changes', version: DSH_VERSION },
  { name: '@deepseek-ai/dsh-web', version: DSH_VERSION },
  { name: '@deepseek-ai/dsh-web-search-deepseek', version: DSH_VERSION },
]

/** A vendored preset declaration file (see `presets.ts`). */
const PRESET_FILE_SUFFIX = '.patch.yml'

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

  const presetFiles = await readdir(presetRoot).catch(() => [] as string[])
  await Promise.all(
    presetFiles
      .filter((file) => file.endsWith(PRESET_FILE_SUFFIX))
      .map(async (file) => {
        // One declaration per vendored file, named after the preset it declares.
        const preset = file.slice(0, -PRESET_FILE_SUFFIX.length)
        const source = await readFile(join(presetRoot, file), 'utf8').catch(() => '')
        for (const match of source.matchAll(PLUGIN_NAME)) {
          const name = match[1]!
          // The declaration row itself, not a plugin the preset composes.
          if (name === AGENT_PRESET_PLUGIN) continue
          const plugin = catalog.get(name)
          if (plugin) {
            if (!plugin.scopes.includes(preset)) plugin.scopes.push(preset)
          } else {
            catalog.set(name, { name, version: DSH_VERSION, scopes: [preset] })
          }
        }
      }),
  )

  return [...catalog.values()]
    .map((plugin) => ({ ...plugin, scopes: [...plugin.scopes].sort() }))
    .sort((a, b) => a.name.localeCompare(b.name))
}
