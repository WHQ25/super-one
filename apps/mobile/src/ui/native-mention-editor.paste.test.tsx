import { expect, jest, test } from '@jest/globals'
import { screen } from '@testing-library/react-native'
import { renderWithTheme } from '../test-render'
import { NativeMentionEditor } from './native-mention-editor'
import { mentionGlyphArtwork } from './mention-glyph-data'
import { GENERATED_DARK_COLORS, GENERATED_LIGHT_COLORS } from '../theme/tokens.generated'
import { pasteChrome } from './mention-artwork.generated.json'

jest.mock('expo', () => ({
  requireOptionalNativeModule: () => ({}),
  requireNativeView: () => (props: object) => require('react').createElement(require('react-native').View, { ...props, testID: 'native-chip-editor' }),
}))

test.each(['light', 'dark'] as const)('passes desktop paste chrome and artwork to the native editor in %s mode', async scheme => {
  const colors = scheme === 'dark' ? GENERATED_DARK_COLORS : GENERATED_LIGHT_COLORS
  await renderWithTheme(<NativeMentionEditor command={{ id: 0, eventCount: 0, start: 0, end: 0,
    text: '\uFFFC', tokens: [{ offset: 0, kind: 'paste', value: 'full pasted text', displayName: 'full pasted text' }] }}
    onChange={() => {}} onError={() => {}} />, scheme)
  const props = screen.getByTestId('native-chip-editor').props
  expect(props.blendedKinds).toContain('paste')
  const { blended: _blended, ...metrics } = pasteChrome
  expect(props.pasteChrome).toEqual(metrics)
  expect(props.mutedForeground).toBe(colors.mutedForeground)
  expect(props.artwork).toContainEqual({ key: 'paste', png: mentionGlyphArtwork('paste', scheme, colors.foreground) })
})
