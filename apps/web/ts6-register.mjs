/**
 * Run ESLint against the classic TypeScript 6 API.
 *
 * typescript-eslint refuses to load under TypeScript 7 (`typescript-eslint does
 * not support TS 7.0`), and eslint-config-next pulls it in, so `next lint` cannot
 * start at all once the workspace is on 7. typescript-eslint resolves
 * `typescript` from the repo root, so pinning this package alone changes nothing
 * — the redirect has to happen inside the ESLint process.
 *
 * Mirrors apps/desktop/.storybook/ts6-register.mjs, which does the same for
 * react-docgen-typescript. Remove both once typescript-eslint supports TS >= 7.1:
 * https://github.com/typescript-eslint/typescript-eslint/issues/10940
 */
import Module from 'node:module'

const originalResolveFilename = Module._resolveFilename
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === 'typescript') {
    return originalResolveFilename.call(this, '@typescript/typescript6', parent, isMain, options)
  }
  if (request.startsWith('typescript/')) {
    const sub = request.slice('typescript/'.length)
    return originalResolveFilename.call(this, `@typescript/typescript6/${sub}`, parent, isMain, options)
  }
  return originalResolveFilename.call(this, request, parent, isMain, options)
}
