import { register } from 'node:module'
import { pathToFileURL } from 'node:url'

/** Redirects `import 'electron'` to `electron-stub.mjs` for out-of-app scripts. */
register(pathToFileURL(new URL('./electron-stub-hooks.mjs', import.meta.url).pathname))
