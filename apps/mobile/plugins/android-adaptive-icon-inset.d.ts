/**
 * Types for `android-adaptive-icon-inset.js`, which has to stay CommonJS because
 * Expo's plugin resolver `require()`s it with Node.
 */

export declare const ADAPTIVE_ICON_INSET: '16%'
export declare const ADAPTIVE_ICON_XML: readonly ['ic_launcher.xml', 'ic_launcher_round.xml']

export declare function applyAdaptiveIconInset(xml: string, inset?: string): string
export declare function applyAdaptiveIconInsetToRes(resDir: string, inset?: string): string[]
