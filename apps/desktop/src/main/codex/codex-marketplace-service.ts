import type {
  CodexMarketplaceAddRequest,
  CodexMarketplaceAddResult,
  CodexMarketplaceUpgradeError,
  CodexMarketplaceUpgradeResult,
} from '@superone/shared/agent-types'
import type { CodexExperimentService } from './codex-experiment-service'

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => readString(entry))
    .filter((entry): entry is string => entry !== null)
}

function compactRecord(input: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) output[key] = value
  }
  return output
}

function mapAddResult(raw: unknown): CodexMarketplaceAddResult {
  const rec = asRecord(raw) ?? {}
  return {
    marketplaceName: readString(rec.marketplaceName) ?? '',
    installedRoot: readString(rec.installedRoot) ?? '',
    alreadyAdded: readBoolean(rec.alreadyAdded) ?? false,
  }
}

function mapUpgradeError(raw: unknown): CodexMarketplaceUpgradeError | null {
  const rec = asRecord(raw)
  if (!rec) return null
  const marketplaceName = readString(rec.marketplaceName) ?? readString(rec.name)
  const message = readString(rec.message) ?? readString(rec.error)
  if (!marketplaceName || !message) return null
  return { marketplaceName, message }
}

function mapUpgradeResult(raw: unknown): CodexMarketplaceUpgradeResult {
  const rec = asRecord(raw) ?? {}
  const errors = Array.isArray(rec.errors)
    ? rec.errors.map(mapUpgradeError).filter((e): e is CodexMarketplaceUpgradeError => e !== null)
    : []
  return {
    selectedMarketplaces: readStringArray(rec.selectedMarketplaces),
    upgradedRoots: readStringArray(rec.upgradedRoots),
    errors,
  }
}

export class CodexMarketplaceService {
  constructor(private readonly codexService: CodexExperimentService) {}

  async add(projectPath: string, request: CodexMarketplaceAddRequest): Promise<CodexMarketplaceAddResult> {
    const source = request.source.trim()
    if (!source) throw new Error('Marketplace source cannot be empty')
    return this.codexService.withAppServerRequest(projectPath, async (rpc) => {
      const result = await rpc('marketplace/add', compactRecord({
        source,
        refName: request.refName?.trim() || undefined,
        sparsePaths: request.sparsePaths && request.sparsePaths.length > 0 ? request.sparsePaths : undefined,
      }))
      return mapAddResult(result)
    })
  }

  async remove(projectPath: string, marketplaceName: string): Promise<void> {
    const name = marketplaceName.trim()
    if (!name) throw new Error('marketplaceName cannot be empty')
    await this.codexService.withAppServerRequest(projectPath, async (rpc) => {
      await rpc('marketplace/remove', { marketplaceName: name })
    })
  }

  async upgrade(projectPath: string, marketplaceName?: string): Promise<CodexMarketplaceUpgradeResult> {
    const name = marketplaceName?.trim() || undefined
    return this.codexService.withAppServerRequest(projectPath, async (rpc) => {
      const result = await rpc('marketplace/upgrade', compactRecord({ marketplaceName: name }))
      return mapUpgradeResult(result)
    })
  }
}
