import { useEffect, useState } from "react"
import { createCodePlugin, type CodeHighlighterPlugin } from "@streamdown/code"
import { useIsDark } from "./use-is-dark"

const EXT_LANG: Record<string, string> = {
  ts: "typescript", tsx: "tsx", mts: "typescript", cts: "typescript",
  js: "javascript", jsx: "jsx", mjs: "javascript", cjs: "javascript",
  py: "python", rb: "ruby", rs: "rust", go: "go", java: "java",
  json: "json", jsonc: "jsonc", json5: "json5", lock: "json",
  yaml: "yaml", yml: "yaml", toml: "toml", ini: "ini",
  html: "html", css: "css", scss: "scss", less: "less", sass: "sass",
  md: "markdown", mdx: "mdx",
  sh: "bash", bash: "bash", zsh: "zsh", fish: "fish",
  sql: "sql", graphql: "graphql", gql: "graphql", prisma: "prisma",
  swift: "swift", kt: "kotlin", c: "c", cpp: "cpp", cs: "csharp", php: "php",
  vue: "vue", svelte: "svelte", astro: "astro",
  xml: "xml", svg: "xml", plist: "xml",
  dart: "dart", r: "r", lua: "lua", scala: "scala", zig: "zig",
  ex: "elixir", exs: "elixir", erl: "erlang", hs: "haskell", clj: "clojure",
  tf: "terraform", hcl: "hcl", proto: "protobuf",
  diff: "diff", patch: "diff", dockerfile: "dockerfile",
}

const NAME_LANG: Record<string, string> = {
  dockerfile: "dockerfile",
  makefile: "makefile",
}

export function inferLanguage(filePath: string): string {
  const name = filePath.split("/").pop()?.toLowerCase() ?? ""
  if (NAME_LANG[name]) return NAME_LANG[name]
  const ext = name.split(".").pop() ?? ""
  return EXT_LANG[ext] ?? "text"
}

const codePluginDark: CodeHighlighterPlugin = createCodePlugin({ themes: ["github-dark", "github-dark"] })
const codePluginLight: CodeHighlighterPlugin = createCodePlugin({ themes: ["github-light", "github-light"] })

export interface DiffHLToken {
  content: string
  color?: string
  bgColor?: string
  htmlStyle?: Record<string, string>
}

export type DiffHLLine = DiffHLToken[]

export function useHighlightedLines(text: string, language: string): DiffHLLine[] | null {
  const isDark = useIsDark()
  const plugin = isDark ? codePluginDark : codePluginLight
  const [lines, setLines] = useState<DiffHLLine[] | null>(null)

  useEffect(() => {
    if (!text || language === "text") {
      setLines(null)
      return
    }
    if (!plugin.supportsLanguage(language as never)) {
      setLines(null)
      return
    }
    let cancelled = false
    const apply = (res: { tokens: Array<DiffHLLine> }) => {
      if (cancelled) return
      setLines(res.tokens.map((line) => line.map((t) => ({ ...t }))))
    }
    const result = plugin.highlight(
      { code: text, language: language as never, themes: plugin.getThemes() },
      apply,
    )
    if (result) apply(result)
    return () => {
      cancelled = true
    }
  }, [text, language, plugin])

  return lines
}
