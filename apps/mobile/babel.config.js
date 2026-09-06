module.exports = function babelConfig(api) {
  api.cache(true)
  return {
    presets: [['babel-preset-expo', { unstable_transformImportMeta: true }]],
    // Reanimated 4 ships its worklet transform here, and it must stay last.
    plugins: ['react-native-worklets/plugin'],
  }
}
