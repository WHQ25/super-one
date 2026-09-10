/**
 * Types for `app-variant.js`, which has to stay CommonJS for Expo's config
 * loader. Declared rather than converted so `scripts/maestro.ts` can import the
 * suffix rule instead of re-deriving it.
 */

export declare const DEV_SCHEME: 'superone-dev'
export declare const DEV_SUFFIX: '.dev'

/**
 * `Record`, not `NodeJS.ProcessEnv`: Expo augments that interface with a
 * required `NODE_ENV`, so callers cannot pass a small literal to it.
 */
type EnvLike = Record<string, string | undefined>

export declare function isDevVariant(env?: EnvLike): boolean
export declare function devApplicationId(releaseId: string): string
export declare function applyAppVariant<T>(config: T, env?: EnvLike): T
