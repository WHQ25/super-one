/**
 * Aggregate harness resource discovery for remote environments.
 *
 * Composes provider model catalogs + FS-backed skills/commands/agents/prompts
 * so remote projects do not depend on desktop CONNECT_* caches.
 */

import { existsSync, readdirSync, readFileSync, type Dirent } from 'node:fs'
import { join } from 'node:path'
import { homedir as osHomedir } from 'node:os'
import type {
  AccountInfo,
  AgentInfo,
  ModelOption,
  SlashCommandInfo,
} from '@superone/shared/agent-types'
import { discoverAllAgents } from '../fs/agents-discover'
import {
  discoverClaudeSkillsAndCommands,
  parseSimpleFrontmatter,
  resolveArgumentHint,
} from '../fs/skills-discover'

export interface HarnessResourcesClaude {
  models: ModelOption[]
  account: AccountInfo
  slashCommands: SlashCommandInfo[]
  skills: SlashCommandInfo[]
  commands: SlashCommandInfo[]
  agents: AgentInfo[]
  outputStyles: string[]
}

export interface HarnessResourcesCodex {
  models: ModelOption[]
  prompts: SlashCommandInfo[]
}

export interface HarnessResourcesOpenCode {
  models: ModelOption[]
  agents: Array<{ id: string; name: string; description?: string; modelId?: string | null }>
  commands: SlashCommandInfo[]
}

export interface HarnessResourcesBundle {
  claude: HarnessResourcesClaude
  codex: HarnessResourcesCodex
  opencode: HarnessResourcesOpenCode
  /** Populated when harnessId is restricted or always as empty shell. */
  acp: { agents: Array<{ id: string; name: string; installed: boolean; commandPreview: string }> }
}

export interface CollectHarnessResourcesInput {
  /** Absolute project path on the node. */
  projectPath: string
  /** Override host home (tests / node isolation). */
  homeDir?: string
  /** Model catalogs keyed by harness id (from provider.listModels). */
  listModels: (harnessId: string, apiProviderId?: string | null) => ModelOption[]
  /**
   * Live catalog probe, used only when {@link listModels} has nothing for a
   * harness (no provider credential bound). Asks the harness on this node what
   * it actually serves instead of assuming a slug list. Failures leave the
   * catalog empty.
   */
  probeModels?: (harnessId: string) => ModelOption[] | Promise<ModelOption[]>
  apiProviderId?: string | null
  /** When set, only fill that harness section (others stay empty defaults). */
  harnessId?: string | null
  /**
   * Optional live account probe. When omitted, account fields stay empty
   * (node may not have Claude CLI / subscription session).
   */
  probeAccount?: () => AccountInfo | Promise<AccountInfo>
  /**
   * Optional live slash-command probe (Claude SDK supportedCommands).
   * When omitted, slashCommands is empty; user/project commands still fill `commands`.
   */
  probeSlashCommands?: () => SlashCommandInfo[] | Promise<SlashCommandInfo[]>
  /**
   * Optional live output-styles probe.
   */
  probeOutputStyles?: () => string[] | Promise<string[]>
}

function emptyClaude(): HarnessResourcesClaude {
  return {
    models: [],
    account: {},
    slashCommands: [],
    skills: [],
    commands: [],
    agents: [],
    outputStyles: [],
  }
}

function emptyCodex(): HarnessResourcesCodex {
  return { models: [], prompts: [] }
}

function emptyOpenCode(): HarnessResourcesOpenCode {
  return { models: [], agents: [], commands: [] }
}

function emptyAcp(): HarnessResourcesBundle['acp'] {
  return { agents: [] }
}

function safeRead(path: string): string {
  try {
    return readFileSync(path, 'utf-8')
  } catch {
    return ''
  }
}

/** Discover ~/.codex/prompts/*.md (desktop discoverCodexUserPrompts parity). */
export function discoverCodexUserPrompts(opts?: { homeDir?: string }): SlashCommandInfo[] {
  const home = opts?.homeDir ?? osHomedir()
  const dir = join(home, '.codex', 'prompts')
  if (!existsSync(dir)) return []
  let ents: Dirent[]
  try {
    ents = readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const out: SlashCommandInfo[] = []
  for (const ent of ents) {
    if (!ent.isFile() || !ent.name.endsWith('.md')) continue
    const name = ent.name.replace(/\.md$/, '')
    const content = safeRead(join(dir, ent.name))
    const fm = parseSimpleFrontmatter(content)
    out.push({
      name,
      description: fm.description ?? '',
      argumentHint: resolveArgumentHint(fm),
      isSkill: false,
    })
  }
  return out
}

function toSlash(skills: Array<{ name: string; description: string; argumentHint: string; isSkill: boolean }>): SlashCommandInfo[] {
  return skills.map((s) => ({
    name: s.name,
    description: s.description,
    argumentHint: s.argumentHint,
    isSkill: s.isSkill,
  }))
}

/**
 * Collect harness resources for a project on the node.
 * Never reads desktop CONNECT_* caches — pure node-local discovery.
 */
export async function collectHarnessResources(
  input: CollectHarnessResourcesInput,
): Promise<HarnessResourcesBundle> {
  const homeDir = input.homeDir
  const only = input.harnessId?.trim().toLowerCase() || null
  const want = (id: string) => !only || only === id

  const { skills, commands } = discoverClaudeSkillsAndCommands(input.projectPath, {
    homeDir: homeDir === undefined ? undefined : homeDir,
  })
  const agents = discoverAllAgents(input.projectPath, { homeDir })
  const skillSlash = toSlash(skills)
  const commandSlash = toSlash(commands)

  const bundle: HarnessResourcesBundle = {
    claude: emptyClaude(),
    codex: emptyCodex(),
    opencode: emptyOpenCode(),
    acp: emptyAcp(),
  }

  const resolveModels = async (harnessId: string): Promise<ModelOption[]> => {
    const listed = input.listModels(harnessId, input.apiProviderId) as ModelOption[]
    if (Array.isArray(listed) && listed.length > 0) return listed
    if (!input.probeModels) return []
    try {
      const probed = await input.probeModels(harnessId)
      return Array.isArray(probed) ? probed : []
    } catch {
      return []
    }
  }

  if (want('claude')) {
    const models = await resolveModels('claude')
    let account: AccountInfo = {}
    if (input.probeAccount) {
      try {
        account = await input.probeAccount()
      } catch {
        account = {}
      }
    }
    let slashCommands: SlashCommandInfo[] = []
    if (input.probeSlashCommands) {
      try {
        slashCommands = await input.probeSlashCommands()
      } catch {
        slashCommands = []
      }
    }
    let outputStyles: string[] = []
    if (input.probeOutputStyles) {
      try {
        outputStyles = await input.probeOutputStyles()
      } catch {
        outputStyles = []
      }
    }
    bundle.claude = {
      models: Array.isArray(models) ? models : [],
      account,
      slashCommands,
      skills: skillSlash,
      commands: commandSlash,
      agents,
      outputStyles,
    }
  }

  if (want('codex')) {
    const models = await resolveModels('codex')
    bundle.codex = {
      models: Array.isArray(models) ? models : [],
      prompts: discoverCodexUserPrompts({ homeDir }),
    }
  }

  if (want('opencode')) {
    const models = await resolveModels('opencode')
    bundle.opencode = {
      models: Array.isArray(models) ? models : [],
      agents: [],
      commands: [],
    }
  }

  if (want('acp')) {
    // ACP agent catalog is desktop-local today; node returns empty shell.
    bundle.acp = emptyAcp()
  }

  return bundle
}
