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
  moduleNameMapper: {
    // This workspace pins react 19.1.0 while the hoisted root has a newer one,
    // so `react-reconciler` and our components would otherwise load different
    // copies and every hook would see a null dispatcher. Pin all of them to the
    // version the app actually ships.
    '^react$': '<rootDir>/node_modules/react',
    '^react/(.*)$': '<rootDir>/node_modules/react/$1',
  },
}
