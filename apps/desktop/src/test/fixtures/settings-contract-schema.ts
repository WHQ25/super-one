import { parse } from '@babel/parser'

/** Fail coverage when a public interface gains a setting without a contract. */
export function interfaceSettingKeys(source: string, name: string): string[] {
  const ast = parse(source, { sourceType: 'module', plugins: ['typescript'] })
  const declaration = ast.program.body.map(node => node.type === 'ExportNamedDeclaration' ? node.declaration : node)
    .find(node => node?.type === 'TSInterfaceDeclaration' && node.id.name === name)
  if (declaration?.type !== 'TSInterfaceDeclaration') throw new Error(`Settings interface not found: ${name}`)
  return declaration.body.body.map(member => {
    if (member.type !== 'TSPropertySignature' || member.key.type !== 'Identifier') throw new Error(`Unclassified setting in ${name}`)
    return member.key.name
  }).sort()
}
