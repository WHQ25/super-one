import type { CodeHighlighterPlugin } from '@streamdown/code'
import { createHighlighterCoreSync } from '@shikijs/core'
import { createJavaScriptRegexEngine } from '@shikijs/engine-javascript'
import githubDark from '@shikijs/themes/github-dark'
import githubLight from '@shikijs/themes/github-light'
import c from '@shikijs/langs/c'
import cpp from '@shikijs/langs/cpp'
import csharp from '@shikijs/langs/csharp'
import css from '@shikijs/langs/css'
import dart from '@shikijs/langs/dart'
import diff from '@shikijs/langs/diff'
import dockerfile from '@shikijs/langs/dockerfile'
import go from '@shikijs/langs/go'
import graphql from '@shikijs/langs/graphql'
import html from '@shikijs/langs/html'
import ini from '@shikijs/langs/ini'
import java from '@shikijs/langs/java'
import json from '@shikijs/langs/json'
import kotlin from '@shikijs/langs/kotlin'
import lua from '@shikijs/langs/lua'
import markdown from '@shikijs/langs/markdown'
import proto from '@shikijs/langs/proto'
import python from '@shikijs/langs/python'
import ruby from '@shikijs/langs/ruby'
import rust from '@shikijs/langs/rust'
import shellscript from '@shikijs/langs/shellscript'
import sql from '@shikijs/langs/sql'
import swift from '@shikijs/langs/swift'
import toml from '@shikijs/langs/toml'
import tsx from '@shikijs/langs/tsx'
import xml from '@shikijs/langs/xml'
import yaml from '@shikijs/langs/yaml'

/**
 * Syntax highlighting for the mobile chat document.
 *
 * `@streamdown/code`'s own plugin — what desktop uses — reaches for Shiki's
 * bundled language map, 722 grammars behind dynamic imports. Desktop code-splits
 * those; this document cannot (`inlineDynamicImports`, single-file build), so
 * they all land inline. Measured: the document goes 7.0 MB → 16.6 MB and the
 * Android WebView then never paints — `source={{ html }}` hands the whole
 * document across as a string, and at that size the transcript stays blank with
 * RSS above 1 GB. So the grammar set is curated instead, ~1.8 MB.
 *
 * `html` pulls `javascript` and `css` in as embedded grammars; that is what
 * makes a plain ```js fence resolvable without paying for a second copy of the
 * JavaScript grammar. TypeScript and JSX ride on `tsx`, which parses ordinary
 * `.ts` correctly apart from the legacy `<T>x` cast — rare in modern code, and
 * the alternative is 370 KB more for two near-identical grammars.
 */
const engine = createJavaScriptRegexEngine({ forgiving: true })

const highlighter = createHighlighterCoreSync({
  engine,
  themes: [githubDark, githubLight],
  langs: [
    c, cpp, csharp, css, dart, diff, dockerfile, go, graphql, html, ini, java,
    json, kotlin, lua, markdown, proto, python, ruby, rust, shellscript, sql,
    swift, toml, tsx, xml, yaml,
  ],
})

const loaded = new Set(highlighter.getLoadedLanguages())

/** Fence tags the loaded grammars answer to but do not register themselves. */
const ALIASES: Record<string, string> = {
  ts: 'tsx', typescript: 'tsx', mts: 'tsx', cts: 'tsx',
  js: 'javascript', jsx: 'tsx', mjs: 'javascript', cjs: 'javascript',
  py: 'python', rb: 'ruby', rs: 'rust', kt: 'kotlin', cs: 'csharp',
  sh: 'shellscript', bash: 'shellscript', zsh: 'shellscript', shell: 'shellscript',
  console: 'shellscript', 'shell-session': 'shellscript',
  yml: 'yaml', md: 'markdown', gql: 'graphql', golang: 'go',
  'c++': 'cpp', 'objective-c': 'c', htm: 'html', svg: 'xml',
  patch: 'diff', protobuf: 'proto', containerfile: 'dockerfile',
}

/** Fence tag → a grammar this highlighter actually holds, or null. */
export function resolveLanguage(raw: string): string | null {
  const value = raw.trim().toLowerCase()
  if (!value) return null
  if (loaded.has(value)) return value
  const alias = ALIASES[value]
  return alias && loaded.has(alias) ? alias : null
}

export function createPortableCodePlugin(theme: 'github-dark' | 'github-light'): CodeHighlighterPlugin {
  return {
    name: 'shiki',
    type: 'code-highlighter',
    getSupportedLanguages: () => [...loaded, ...Object.keys(ALIASES)] as never,
    getThemes: () => [theme, theme],
    supportsLanguage: (language) => resolveLanguage(language) !== null,
    highlight: ({ code, language }) => {
      const lang = resolveLanguage(language)
      if (!lang) return null
      // Sync engine, sync grammars: the callback path never has to run.
      return highlighter.codeToTokens(code, { lang, theme }) as never
    },
  }
}
