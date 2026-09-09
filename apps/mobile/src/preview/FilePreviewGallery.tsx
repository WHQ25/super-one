import { useState } from 'react'
import { View } from 'react-native'
import { FilePreviewScreen } from '../screens/file-preview-screen'
import type { FilePreviewState } from '../file-preview-state'
import { SelectionField } from '../ui'
import { FILE_PREVIEW_FIXTURES } from './file-preview-fixtures'

/**
 * Every state the file preview page can reach, one at a time.
 *
 * The page fills the pane, so the states are switched rather than stacked. The
 * two relay transfer rows are the ones worth reviewing here: reproducing them
 * against a live desktop means pairing through the relay on purpose and tapping
 * a large file — this gets there in one pick.
 */
export function FilePreviewGallery() {
  const [label, setLabel] = useState(FILE_PREVIEW_FIXTURES[0].label)
  const [started, setStarted] = useState(false)
  const fixture = FILE_PREVIEW_FIXTURES.find((item) => item.label === label) ?? FILE_PREVIEW_FIXTURES[0]
  // The Download button flips the real card into its started state so the
  // transition can be seen, not just its two ends.
  const state: FilePreviewState = fixture.state.kind === 'transfer' && started
    ? { ...fixture.state, started: true }
    : fixture.state
  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 12, paddingVertical: 6 }}>
        <SelectionField compact label="State" value={label}
          options={FILE_PREVIEW_FIXTURES.map((item) => ({ value: item.label, label: item.label }))}
          onChange={(next) => { setLabel(next); setStarted(false) }} />
      </View>
      <FilePreviewScreen state={state} onStartTransfer={() => setStarted(true)} onRetry={() => setStarted(false)} />
    </View>
  )
}
