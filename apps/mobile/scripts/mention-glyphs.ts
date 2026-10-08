import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { hex, parseOklch } from './color-tokens'
import { GENERATED_DARK_COLORS, GENERATED_LIGHT_COLORS } from '../src/theme/tokens.generated'

/** Read the desktop's literal Lucide returns without loading its DOM/editor runtime. */
export function desktopMentionGlyphs() {
  const path = resolve(import.meta.dirname, '../../../packages/ui/src/components/ui/mention-icons.tsx')
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const theme = readFileSync(resolve(import.meta.dirname, '../../../node_modules/tailwindcss/theme.css'), 'utf8')
  const result: Record<string, { icon: string; light: string; dark: string }> = {}
  function tone(classes: string, dark: boolean) {
    const names = classes.split(/\s+/)
    const name = ((dark && names.find((name) => name.startsWith('dark:text-'))) || names.find((name) => name.startsWith('text-')))?.replace(/^(dark:)?text-/, '')
    if (!name) throw new Error(`Missing mention icon color: ${classes}`)
    return name === 'foreground' ? '$foreground' : hex(parseOklch(theme, `color-${name}`))
  }
  for (const fn of source.statements) {
    if (!ts.isFunctionDeclaration(fn) || !['staticMentionIcon'].includes(fn.name?.text ?? '') || !fn.body) continue
    for (const statement of fn.body.statements) {
      if (!ts.isIfStatement(statement) || !ts.isBinaryExpression(statement.expression)) continue
      const { left, right, operatorToken } = statement.expression
      if (left.getText(source) !== 'kind' || operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken || !ts.isStringLiteral(right)) continue
      const returned = statement.thenStatement
      if (!ts.isReturnStatement(returned) || !returned.expression || !ts.isJsxSelfClosingElement(returned.expression)) continue
      const jsx = returned.expression
      const attr = jsx.attributes.properties.find((attr) => ts.isJsxAttribute(attr) && attr.name.getText(source) === 'className')
      if (!attr || !ts.isJsxAttribute(attr) || !attr.initializer || !ts.isStringLiteral(attr.initializer)) continue
      result[right.text] = { icon: jsx.tagName.getText(source), light: tone(attr.initializer.text, false), dark: tone(attr.initializer.text, true) }
    }
  }
  for (const kind of ['agent', 'directory', 'session', 'git:branch', 'git:commit', 'git:worktree', 'git:tag', 'git:issue', 'git:pr', 'github', 'collab', 'computer', 'browser', 'widget', 'debug']) {
    if (!result[kind]) throw new Error(`Desktop mention glyph ${kind} changed shape; adapt the generator`)
  }
  return result
}

/** The paste chip uses the presenter's FileText artwork, rather than a native approximation. */
export function desktopPastePresentation() {
  const path = resolve(import.meta.dirname, '../../../packages/chat-view/src/presenters/PasteChip.tsx')
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let icon: string | undefined
  function visit(node: ts.Node) {
    if (ts.isJsxAttribute(node) && node.name.getText(source) === 'icon' && node.initializer
      && ts.isJsxExpression(node.initializer) && node.initializer.expression && ts.isJsxSelfClosingElement(node.initializer.expression)) {
      icon = node.initializer.expression.tagName.getText(source)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  if (!icon) throw new Error('Desktop paste chip icon changed shape; adapt the generator')
  const body = readFileSync(resolve(import.meta.dirname, '../../../packages/ui/src/components/ui/MentionChipBody.tsx'), 'utf8')
  const classes = body.slice(body.indexOf('export function MentionChipContent')).match(/className=\{cn\('([^']+)'/)?.[1].split(/\s+/)
  const kind = classes?.find(name => name.startsWith('mention-chip--'))
  const css = readFileSync(resolve(import.meta.dirname, '../../../packages/ui/src/styles/mention-chip.css'), 'utf8')
  const rule = (name: string) => css.match(new RegExp(`\\.${name}\\s*\\{([^}]+)\\}`))?.[1] ?? ''
  if (!kind) throw new Error('Desktop mention chip chrome changed shape; adapt the generator')
  const chrome = rule(kind)
  const em = (rules: string, property: string, fallback?: number) => {
    const match = rules.match(new RegExp(`(?:^|[;\\n])\\s*${property}:\\s*(-?[\\d.]+)em\\s*;`))
    if (match) return Number(match[1])
    if (fallback !== undefined) return fallback
    throw new Error(`Desktop chip ${property} changed shape; adapt the generator`)
  }
  const color = chrome.match(/color:\s*var\(--([\w-]+)\)/)?.[1]
  const tone = color === 'muted-foreground' ? 'mutedForeground' : color === 'foreground' ? 'foreground' : undefined
  if (!tone) throw new Error('Desktop paste chip color changed shape; adapt the generator')
  return {
    glyph: { icon, light: GENERATED_LIGHT_COLORS[tone], dark: GENERATED_DARK_COLORS[tone] },
    chrome: { blended: !/background:/.test(chrome), marginEm: em(chrome, 'margin-left'), paddingEm: em(chrome, 'padding-left', 0),
      iconSizeEm: em(rule('mention-chip__icon'), 'width'), iconGapEm: em(rule('mention-chip__icon'), 'margin-right'),
      iconBaselineEm: -em(rule('mention-chip__icon'), 'vertical-align') },
  }
}

export function desktopPasteGlyph() { return desktopPastePresentation().glyph }
