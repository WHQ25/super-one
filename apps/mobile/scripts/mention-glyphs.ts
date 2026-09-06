import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { hex, parseOklch } from './color-tokens'

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
  for (const kind of ['agent', 'directory', 'session', 'collab', 'computer', 'browser', 'widget', 'debug']) {
    if (!result[kind]) throw new Error(`Desktop mention glyph ${kind} changed shape; adapt the generator`)
  }
  return result
}
