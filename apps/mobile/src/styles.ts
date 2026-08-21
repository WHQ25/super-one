import { StyleSheet } from 'react-native'

export const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#111111', paddingTop: 56, paddingHorizontal: 16 },
  flex: { flex: 1 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  back: { color: '#a78bfa', fontSize: 16 },
  title: { color: '#f4f4f5', fontSize: 24, fontWeight: '600', flex: 1 },
  input: {
    borderWidth: 1, borderColor: '#3f3f46', borderRadius: 8, color: '#f4f4f5',
    paddingHorizontal: 12, paddingVertical: 10, marginBottom: 10,
  },
  multi: { minHeight: 88, textAlignVertical: 'top' },
  btn: { backgroundColor: '#3f3f46', borderRadius: 8, paddingVertical: 12, alignItems: 'center', marginBottom: 12 },
  btnText: { color: '#f4f4f5', fontWeight: '600' },
  code: { color: '#f4f4f5', fontSize: 32, letterSpacing: 8, textAlign: 'center', marginVertical: 16 },
  row: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#27272a' },
  rowTitle: { color: '#f4f4f5', fontSize: 16 },
  rowMeta: { color: '#71717a', fontSize: 12, marginTop: 4 },
  composer: { flexDirection: 'row', gap: 8, paddingVertical: 8, alignItems: 'center' },
  composerInput: {
    flex: 1, borderWidth: 1, borderColor: '#3f3f46', borderRadius: 8, color: '#f4f4f5',
    paddingHorizontal: 12, paddingVertical: 10,
  },
  send: { backgroundColor: '#3f3f46', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 12 },
  meta: { color: '#71717a', fontSize: 12, paddingVertical: 8 },
  modal: { flex: 1, backgroundColor: '#000000cc', justifyContent: 'center', padding: 24 },
  planBox: { maxHeight: 240, marginVertical: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  chip: { borderWidth: 1, borderColor: '#3f3f46', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  chipOn: { borderColor: '#a78bfa', backgroundColor: '#2a2140' },
  overlay: { maxHeight: 180, backgroundColor: '#18181b', borderRadius: 8, marginBottom: 8 },
})
