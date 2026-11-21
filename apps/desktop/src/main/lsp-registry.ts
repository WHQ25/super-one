import { execFile } from 'node:child_process'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Open as unzipOpen } from 'unzipper'
import type { LspLanguageStat, LspProjectDetection } from '@superone/shared/desktop-lsp'
import { superoneHome } from './superone-home'

const REGISTRY_ZIP_URL = 'https://github.com/mason-org/mason-registry/releases/latest/download/registry.json.zip'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

export interface MasonRegistryEntry {
  id: string
  label: string
  description: string
  homepage: string | null
  githubRepo: string | null
  languages: string[]
  sourceId: string
  binaryName: string
  args: string[]
  purlType: 'npm' | 'pypi' | 'golang' | 'cargo' | 'github' | 'other'
  packageName: string | null
  installable: boolean
  installHint: string | null
}

export interface InstalledRegistryServer {
  id: string
  label: string
  description: string
  homepage: string | null
  languages: string[]
  sourceId: string
  binaryName: string
  binaryPath: string
  args: string[]
  version: string | null
}

interface RawMasonPackage {
  name?: string
  description?: string
  homepage?: string
  languages?: string[]
  categories?: string[]
  source?: { id?: string }
  bin?: Record<string, string>
}

const MASON_LANG_ALIAS: Record<string, string> = {
  'c++': 'cpp',
  'c#': 'csharp',
  'f#': 'fsharp',
  'objective-c': 'objc',
  'shell': 'bash',
  'sh': 'bash',
  'dockerfile': 'dockerfile',
  'typescript': 'typescript',
  'javascript': 'javascript',
  'python': 'python',
  'rust': 'rust',
  'go': 'go',
  'json': 'json',
  'yaml': 'yaml',
  'css': 'css',
  'scss': 'scss',
  'less': 'less',
  'html': 'html',
  'vue': 'vue',
  'svelte': 'svelte',
  'astro': 'astro',
  'lua': 'lua',
  'ruby': 'ruby',
  'java': 'java',
  'kotlin': 'kotlin',
  'swift': 'swift',
  'dart': 'dart',
  'zig': 'zig',
  'elixir': 'elixir',
  'haskell': 'haskell',
  'php': 'php',
  'sql': 'sql',
  'graphql': 'graphql',
  'prisma': 'prisma',
  'terraform': 'terraform',
  'toml': 'toml',
  'markdown': 'markdown',
}

function normalizeMasonLanguage(raw: string): string {
  const lower = raw.trim().toLowerCase()
  return MASON_LANG_ALIAS[lower] ?? lower
}

export function parseMasonPurl(sourceId: string): {
  purlType: MasonRegistryEntry['purlType']
  packageName: string | null
  installable: boolean
  installHint: string | null
} {
  if (!sourceId.startsWith('pkg:')) {
    return { purlType: 'other', packageName: null, installable: false, installHint: null }
  }
  const withoutScheme = sourceId.slice(4)
  const slashIdx = withoutScheme.indexOf('/')
  if (slashIdx < 0) {
    return { purlType: 'other', packageName: null, installable: false, installHint: null }
  }
  const type = withoutScheme.slice(0, slashIdx)
  const rest = withoutScheme.slice(slashIdx + 1).split('?')[0].split('#')[0]
  const lastAt = rest.lastIndexOf('@')
  const pkgPath = lastAt > 0 ? decodeURIComponent(rest.slice(0, lastAt)) : decodeURIComponent(rest)

  if (type === 'npm') {
    return { purlType: 'npm', packageName: pkgPath, installable: true, installHint: null }
  }
  if (type === 'pypi') {
    return { purlType: 'pypi', packageName: pkgPath, installable: true, installHint: null }
  }
  if (type === 'golang') {
    return {
      purlType: 'golang',
      packageName: pkgPath,
      installable: true,
      installHint: `go install ${pkgPath}@latest`,
    }
  }
  if (type === 'cargo') {
    return {
      purlType: 'cargo',
      packageName: pkgPath,
      installable: true,
      installHint: `cargo install ${pkgPath}`,
    }
  }
  if (type === 'github') {
    return {
      purlType: 'github',
      packageName: pkgPath,
      installable: false,
      installHint: `https://github.com/${pkgPath}`,
    }
  }
  return { purlType: 'other', packageName: pkgPath, installable: false, installHint: null }
}

export function extractGithubRepo(sourceId?: string | null, homepage?: string | null): string | null {
  if (sourceId?.startsWith('pkg:github/')) {
    const rest = sourceId.slice('pkg:github/'.length).split('@')[0].split('?')[0].split('#')[0]
    const parts = rest.split('/').filter(Boolean)
    if (parts.length >= 2) return `${parts[0]}/${parts[1]}`
  }
  if (homepage) {
    const match = /^https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/i.exec(homepage.trim())
    if (match) {
      return `${match[1]}/${match[2].replace(/\.git$/, '')}`
    }
  }
  return null
}

function toRegistryEntry(raw: RawMasonPackage): MasonRegistryEntry | null {
  if (!raw.name || !Array.isArray(raw.categories) || !raw.categories.includes('LSP')) {
    return null
  }
  const sourceId = raw.source?.id ?? ''
  const parsed = parseMasonPurl(sourceId)
  const binKeys = raw.bin ? Object.keys(raw.bin) : []
  const binaryName = binKeys[0] ?? raw.name
  const languages = Array.from(
    new Set((raw.languages ?? []).map(normalizeMasonLanguage).filter(Boolean)),
  )
  const homepage = raw.homepage ?? null
  return {
    id: raw.name,
    label: raw.name,
    description: raw.description ?? '',
    homepage,
    githubRepo: extractGithubRepo(sourceId, homepage),
    languages,
    sourceId,
    binaryName,
    args: ['--stdio'],
    purlType: parsed.purlType,
    packageName: parsed.packageName,
    installable: parsed.installable,
    installHint: parsed.installHint ?? raw.homepage ?? null,
  }
}

function lspRootDir(): string {
  return join(superoneHome(), 'lsp')
}

function registryCachePath(): string {
  return join(lspRootDir(), 'registry-cache.json')
}

function installedRegistryPath(): string {
  return join(lspRootDir(), 'installed-registry.json')
}

export async function loadInstalledRegistryServers(): Promise<Record<string, InstalledRegistryServer>> {
  try {
    const raw = await readFile(installedRegistryPath(), 'utf8')
    const parsed = JSON.parse(raw) as Record<string, InstalledRegistryServer>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export async function saveInstalledRegistryServers(
  records: Record<string, InstalledRegistryServer>,
): Promise<void> {
  await mkdir(lspRootDir(), { recursive: true })
  await writeFile(installedRegistryPath(), JSON.stringify(records, null, 2), 'utf8')
}

let memoryCache: MasonRegistryEntry[] | null = null

export async function fetchMasonLspRegistry(forceRefresh = false): Promise<MasonRegistryEntry[]> {
  if (!forceRefresh && memoryCache) {
    return memoryCache
  }

  const cacheFile = registryCachePath()
  if (!forceRefresh) {
    try {
      const info = await stat(cacheFile)
      if (Date.now() - info.mtimeMs < CACHE_TTL_MS) {
        const cachedRaw = await readFile(cacheFile, 'utf8')
        const parsed = JSON.parse(cachedRaw) as MasonRegistryEntry[]
        if (Array.isArray(parsed) && parsed.length > 0) {
          memoryCache = parsed.map((e) => ({
            ...e,
            githubRepo: e.githubRepo ?? extractGithubRepo(e.sourceId, e.homepage),
          }))
          return memoryCache
        }
      }
    } catch {
    }
  }

  const res = await fetch(REGISTRY_ZIP_URL)
  if (!res.ok) {
    throw new Error(`Failed to fetch mason-registry: HTTP ${res.status}`)
  }
  const buf = Buffer.from(await res.arrayBuffer())
  const archive = await unzipOpen.buffer(buf)
  const jsonFile = archive.files.find((f) => f.path === 'registry.json' || f.path.endsWith('/registry.json'))
  if (!jsonFile) {
    throw new Error('registry.json not found in mason-registry archive')
  }
  const content = (await jsonFile.buffer()).toString('utf8')
  const rawList = JSON.parse(content) as RawMasonPackage[]
  const entries = rawList
    .map(toRegistryEntry)
    .filter((item): item is MasonRegistryEntry => item !== null)
    .sort((a, b) => a.id.localeCompare(b.id))

  await mkdir(lspRootDir(), { recursive: true })
  await writeFile(cacheFile, JSON.stringify(entries), 'utf8')
  memoryCache = entries
  return entries
}

function starsCachePath(): string {
  return join(lspRootDir(), 'github-stars-cache.json')
}

function getGhAuthToken(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('gh', ['auth', 'token'], { env: process.env, timeout: 3000 }, (err, stdout) => {
      if (err) {
        resolve(null)
        return
      }
      const token = stdout.trim()
      resolve(token.length > 0 ? token : null)
    })
  })
}

export async function readCachedGithubStars(): Promise<Record<string, number>> {
  try {
    const raw = await readFile(starsCachePath(), 'utf8')
    const parsed = JSON.parse(raw) as Record<string, number>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export async function fetchGithubStarsForRepos(
  repos: string[],
  forceRefresh = false,
): Promise<{ hasGh: boolean; stars: Record<string, number> }> {
  const token = await getGhAuthToken()
  if (!token) {
    return { hasGh: false, stars: {} }
  }

  let cachedStars: Record<string, number> = {}
  const cacheFile = starsCachePath()
  if (!forceRefresh) {
    try {
      const info = await stat(cacheFile)
      if (Date.now() - info.mtimeMs < CACHE_TTL_MS) {
        const raw = await readFile(cacheFile, 'utf8')
        const parsed = JSON.parse(raw) as Record<string, number>
        if (parsed && typeof parsed === 'object') {
          cachedStars = parsed
        }
      }
    } catch {
    }
  }

  const uniqueRepos = Array.from(new Set(repos.filter(Boolean)))
  const missing = uniqueRepos.filter((slug) => typeof cachedStars[slug] !== 'number')
  if (missing.length === 0) {
    return { hasGh: true, stars: cachedStars }
  }

  const BATCH_SIZE = 50
  for (let i = 0; i < missing.length; i += BATCH_SIZE) {
    const batch = missing.slice(i, i + BATCH_SIZE)
    const fields = batch
      .map((slug, idx) => {
        const [owner, name] = slug.split('/')
        if (!owner || !name) return ''
        return `r${idx}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { stargazerCount }`
      })
      .filter(Boolean)
      .join('\n')
    if (!fields) continue

    try {
      const res = await fetch('https://api.github.com/graphql', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'User-Agent': 'SuperOne',
        },
        body: JSON.stringify({ query: `query { ${fields} }` }),
      })
      if (!res.ok) continue
      const json = (await res.json()) as { data?: Record<string, { stargazerCount?: number } | null> }
      const data = json.data
      if (!data) continue
      batch.forEach((slug, idx) => {
        const repoData = data[`r${idx}`]
        if (repoData && typeof repoData.stargazerCount === 'number') {
          cachedStars[slug] = repoData.stargazerCount
        }
      })
    } catch {
    }
  }

  await mkdir(lspRootDir(), { recursive: true })
  await writeFile(cacheFile, JSON.stringify(cachedStars), 'utf8')
  return { hasGh: true, stars: cachedStars }
}

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  'target',
  '.venv',
  'venv',
  '__pycache__',
  '.next',
  '.turbo',
  'coverage',
  '.cache',
])

const EXT_LANGS: Record<string, string> = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  py: 'python',
  rs: 'rust',
  go: 'go',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'html',
  vue: 'vue',
  svelte: 'svelte',
  astro: 'astro',
  lua: 'lua',
  rb: 'ruby',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  dart: 'dart',
  zig: 'zig',
  c: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  h: 'c',
  hpp: 'cpp',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  sql: 'sql',
  tf: 'terraform',
  mdx: 'mdx',
}

const CONFIG_SERVER_SIGNALS: Array<{ match: (name: string) => boolean; servers: string[] }> = [
  { match: (n) => n === 'deno.json' || n === 'deno.jsonc', servers: ['deno', 'denols'] },
  { match: (n) => n === 'biome.json' || n === 'biome.jsonc', servers: ['biome'] },
  { match: (n) => n === 'ruff.toml' || n === '.ruff.toml', servers: ['ruff', 'ruff-lsp'] },
  { match: (n) => n === 'pyrightconfig.json', servers: ['pyright', 'basedpyright'] },
  { match: (n) => n.startsWith('tailwind.config.'), servers: ['tailwindcss-language-server'] },
  { match: (n) => n === 'tsconfig.json', servers: ['typescript', 'typescript-language-server', 'vtsls'] },
  { match: (n) => n.startsWith('.eslintrc') || n.startsWith('eslint.config.'), servers: ['eslint-lsp'] },
]

function listGitTrackedFiles(workspaceRoot: string): Promise<string[] | null> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['ls-files', '-z'],
      { cwd: workspaceRoot, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          resolve(null)
          return
        }
        resolve(stdout.split('\0').filter(Boolean))
      },
    )
  })
}

export async function detectProjectLspLanguages(workspaceRoot: string): Promise<LspProjectDetection> {
  const byteTotals = new Map<string, number>()
  const preferredServers = new Set<string>()
  let totalBytes = 0

  const tracked = await listGitTrackedFiles(workspaceRoot)
  let files: string[] = []

  if (tracked) {
    files = tracked
    for (const rel of files) {
      if (!rel.includes('/')) {
        const lowerName = rel.toLowerCase()
        for (const signal of CONFIG_SERVER_SIGNALS) {
          if (signal.match(lowerName)) {
            for (const s of signal.servers) preferredServers.add(s)
          }
        }
      }
    }
  } else {
    let scannedFiles = 0
    const walk = async (dir: string, depth: number): Promise<void> => {
      if (depth > 8 || scannedFiles >= 5000) return
      let entries
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        if (scannedFiles >= 5000) break
        const lowerName = entry.name.toLowerCase()
        if (entry.isDirectory()) {
          if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue
          await walk(join(dir, entry.name), depth + 1)
          continue
        }
        if (!entry.isFile()) continue
        scannedFiles += 1
        files.push(join(dir, entry.name))
        if (depth === 0) {
          for (const signal of CONFIG_SERVER_SIGNALS) {
            if (signal.match(lowerName)) {
              for (const s of signal.servers) preferredServers.add(s)
            }
          }
        }
      }
    }
    await walk(workspaceRoot, 0)
  }

  const candidates: Array<{ fullPath: string; lang: string }> = []
  for (const file of files) {
    const lower = file.toLowerCase()
    if (lower.endsWith('.d.ts') || lower.endsWith('.generated.ts') || lower.endsWith('.generated.js')) continue
    const dot = lower.lastIndexOf('.')
    if (dot <= 0) continue
    const ext = lower.slice(dot + 1)
    const lang = EXT_LANGS[ext]
    if (!lang) continue
    candidates.push({
      fullPath: tracked ? join(workspaceRoot, file) : file,
      lang,
    })
  }

  const BATCH_SIZE = 64
  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE)
    const sizes = await Promise.all(
      batch.map(async ({ fullPath, lang }) => {
        try {
          const info = await stat(fullPath)
          return { lang, size: info.size }
        } catch {
          return { lang, size: 0 }
        }
      }),
    )
    for (const { lang, size } of sizes) {
      if (size <= 0) continue
      byteTotals.set(lang, (byteTotals.get(lang) ?? 0) + size)
      totalBytes += size
    }
  }

  const languages: LspLanguageStat[] =
    totalBytes === 0
      ? []
      : Array.from(byteTotals.entries())
          .map(([language, count]) => ({
            language,
            count,
            ratio: count / totalBytes,
          }))
          .sort((a, b) => b.count - a.count)

  return {
    languages,
    preferredServers: Array.from(preferredServers),
  }
}
