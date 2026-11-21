export interface LspLanguageTarget {
  serverId: string
  languageId: string
}

const LANGUAGE_TARGETS: Record<string, LspLanguageTarget> = {
  typescript: { serverId: 'typescript', languageId: 'typescript' },
  tsx: { serverId: 'typescript', languageId: 'typescriptreact' },
  javascript: { serverId: 'typescript', languageId: 'javascript' },
  jsx: { serverId: 'typescript', languageId: 'javascriptreact' },
  python: { serverId: 'python', languageId: 'python' },
  json: { serverId: 'json', languageId: 'json' },
  jsonc: { serverId: 'json', languageId: 'jsonc' },
  css: { serverId: 'css', languageId: 'css' },
  scss: { serverId: 'css', languageId: 'scss' },
  less: { serverId: 'css', languageId: 'less' },
  html: { serverId: 'html', languageId: 'html' },
  yaml: { serverId: 'yaml', languageId: 'yaml' },
  go: { serverId: 'go', languageId: 'go' },
  rust: { serverId: 'rust', languageId: 'rust' },
  c: { serverId: 'clangd', languageId: 'c' },
  cpp: { serverId: 'clangd', languageId: 'cpp' },
}

export function resolveLspTarget(language: string | null | undefined): LspLanguageTarget | null {
  if (!language) return null
  return LANGUAGE_TARGETS[language.toLowerCase()] ?? null
}

const SERVER_PRIORITY_RANK: Record<string, number> = {
  typescript: 100,
  'typescript-language-server': 100,
  vtsls: 95,
  pyright: 100,
  python: 100,
  basedpyright: 95,
  'rust-analyzer': 100,
  rust: 100,
  gopls: 100,
  go: 100,
  clangd: 100,
  'lua-language-server': 100,
  json: 100,
  'json-lsp': 100,
  'vscode-json-language-server': 100,
  css: 100,
  'css-lsp': 100,
  'vscode-css-language-server': 100,
  html: 100,
  'html-lsp': 100,
  'vscode-html-language-server': 100,
  yaml: 100,
  'yaml-language-server': 100,
  'vue-language-server': 100,
  'svelte-language-server': 100,
  'astro-language-server': 100,
  jdtls: 100,
  'kotlin-language-server': 100,
  zls: 100,
  'ruby-lsp': 100,
  intelephense: 100,
  'bash-language-server': 100,
  'terraform-ls': 100,
  taplo: 100,
  'python-lsp-server': 60,
  'jedi-language-server': 55,
  ccls: 60,
  deno: 60,
  denols: 60,
  ruff: 65,
  'ruff-lsp': 60,
  biome: 65,
  'eslint-lsp': 60,
  'tailwindcss-language-server': 65,
  'emmet-ls': 50,
  'emmet-language-server': 50,
  'typos-lsp': 5,
  'cspell-lsp': 5,
  'harper-ls': 5,
  'ltex-ls': 5,
  'ltex-ls-plus': 5,
  efm: 5,
  'diagnostic-languageserver': 5,
  'ast-grep': 5,
  codebook: 5,
  snyk: 5,
  'wc-language-server': 20,
  'kmp-lsp': 20,
}

export function getServerPriorityRank(serverId: string): number {
  return SERVER_PRIORITY_RANK[serverId] ?? 30
}

const LANGUAGE_COLORS: Record<string, string> = {
  typescript: '#3178c6',
  javascript: '#f1e05a',
  html: '#e34c26',
  css: '#563d7c',
  scss: '#c6538c',
  less: '#1d365d',
  swift: '#F05138',
  python: '#3572A5',
  rust: '#dea584',
  go: '#00ADD8',
  c: '#555555',
  cpp: '#f34b7d',
  java: '#b07219',
  kotlin: '#A97BFF',
  ruby: '#701516',
  php: '#4F5D95',
  vue: '#41b883',
  svelte: '#ff3e00',
  astro: '#ff5a03',
  lua: '#000080',
  dart: '#00B4AB',
  zig: '#ec915c',
  bash: '#89e051',
  sql: '#e38c00',
  terraform: '#5c4ee5',
  mdx: '#fcb32c',
}

export function getLanguageColor(language: string): string {
  return LANGUAGE_COLORS[language.toLowerCase()] ?? '#8b949e'
}
