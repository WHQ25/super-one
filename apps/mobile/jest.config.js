/**
 * Component tests only. Pure state modules stay on vitest (`vitest.config.ts`),
 * which is faster and needs no React Native transform.
 *
 * jest-expo owns the transform, module mapping and native mocks for RN 0.81 —
 * the same pipeline Metro uses. Reproducing it under vitest fails at React
 * Native's lazy `require()` boundary: Vite hands the nested requires to Node,
 * which cannot parse Flow.
 */
module.exports = {
  preset: 'jest-expo',
  testMatch: ['<rootDir>/src/**/*.test.tsx'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  // jest-expo's list plus the ESM-only highlighter (`lowlight` and its `devlop`
  // assert helper); highlight.js itself ships CommonJS and needs no transform.
  transformIgnorePatterns: [
    '/node_modules/(?!(.pnpm|react-native|@react-native|@react-native-community|expo|@expo|@expo-google-fonts|react-navigation|@react-navigation|@sentry/react-native|native-base|lowlight|devlop))',
    '/node_modules/react-native-reanimated/plugin/',
  ],
  moduleNameMapper: {
    // This workspace pins react 19.1.0 while the hoisted root has a newer one,
    // so `react-reconciler` and our components would otherwise load different
    // copies and every hook would see a null dispatcher. Pin all of them to the
    // version the app actually ships.
    '^react$': '<rootDir>/node_modules/react',
    '^react/(.*)$': '<rootDir>/node_modules/react/$1',
    // `marked` publishes ESM-only under `main`; jest-expo leaves node_modules
    // untransformed, so the UMD build stands in for the markdown renderer.
    '^marked$': '<rootDir>/../../node_modules/marked/lib/marked.umd.js',
    // `lucide-react-native` 1.x points its `react-native` condition — the one
    // jest-expo resolves first — at an `.mjs` build, which Jest always treats as
    // ESM whatever the transform; its own CommonJS build stands in.
    '^lucide-react-native$': '<rootDir>/../../node_modules/lucide-react-native/dist/cjs/lucide-react-native.js',
  },
}
