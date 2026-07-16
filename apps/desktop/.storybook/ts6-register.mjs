/**
 * Force classic TypeScript 6 API for Storybook tooling only.
 * TypeScript 7's package main export is a native-port stub (no ts.sys / JsxEmit),
 * which crashes react-docgen-typescript when @storybook/react's preset loads.
 *
 * Project code keeps using typescript@7 for `tsc`; this hook only applies to the
 * Storybook Node process started via run.mjs.
 */
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Module from 'node:module'

const require = createRequire(import.meta.url)
const ts6Root = dirname(require.resolve('@typescript/typescript6/package.json'))

// CJS require('typescript') — used by react-docgen-typescript
const originalResolveFilename = Module._resolveFilename
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === 'typescript' || request.startsWith('typescript/')) {
    const sub = request === 'typescript' ? '.' : `./${request.slice('typescript/'.length)}`
    // Resolve relative to the ts6 package so we never hit the TS7 stub.
    try {
      return originalResolveFilename.call(this, join(ts6Root, sub === '.' ? 'lib/typescript.js' : sub), parent, isMain, options)
    } catch {
      // fall through to package name resolution
      return originalResolveFilename.call(this, request === 'typescript' ? '@typescript/typescript6' : `@typescript/typescript6/${request.slice('typescript/'.length)}`, parent, isMain, options)
    }
  }
  return originalResolveFilename.call(this, request, parent, isMain, options)
}

// ESM import('typescript') — if any Storybook path uses it
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'
register(pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), 'ts6-resolve-hook.mjs')).href)
