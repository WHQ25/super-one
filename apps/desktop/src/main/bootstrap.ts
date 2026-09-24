/**
 * Main-process entry. Turns on V8's on-disk compile cache before the app
 * bundle loads, so warm launches skip compiling the multi-megabyte main
 * bundle and its ESM dependencies (~130ms on an M1 Max).
 */
import { enableCompileCache } from 'node:module'

enableCompileCache()
await import('./index')
