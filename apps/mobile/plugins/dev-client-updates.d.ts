/**
 * Types for `dev-client-updates.js`, which has to stay CommonJS because Expo's
 * plugin resolver `require()`s it with Node. Declared rather than converted so
 * the vitest suite can import the helpers under `strict`.
 */

export declare const UPDATES_ENABLED_META_NAME: 'expo.modules.updates.ENABLED'
export declare const UPDATES_DISABLED_META: string
export declare const FINGERPRINT_GRADLE_MARKER: string
export declare const FINGERPRINT_GRADLE_SNIPPET: string

export declare function disableUpdatesInDebugManifest(manifest: string): string
export declare function ensureFingerprintResourcesTaskInvalidWhenMissing(gradle: string): string
