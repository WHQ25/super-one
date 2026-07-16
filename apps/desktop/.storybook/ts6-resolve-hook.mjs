/**
 * Redirect `typescript` imports to `@typescript/typescript6` (classic TS 5/6 API).
 * TypeScript 7's main export is a native-port stub without ts.sys / JsxEmit, which
 * breaks react-docgen-typescript and therefore @storybook/react's preset.
 * Only active when Storybook is launched via ts6-register.mjs.
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'typescript') {
    return nextResolve('@typescript/typescript6', context)
  }
  if (specifier.startsWith('typescript/')) {
    return nextResolve(`@typescript/typescript6/${specifier.slice('typescript/'.length)}`, context)
  }
  return nextResolve(specifier, context)
}
