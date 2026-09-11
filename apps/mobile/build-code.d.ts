/**
 * Types for `build-code.js`, which has to stay CommonJS for Expo's config
 * loader. Declared rather than converted so `scripts/assert-release-config.ts`
 * can assert against the real constant instead of a second copy.
 */

export declare const BUILD_CODE: number

export declare function applyBuildCode<T>(config: T, buildCode?: number): T
