import { EditorView } from '@codemirror/view'
import { MONO_FONT_FAMILY } from '@/lib/pretext-utils'

export const codeEditorTheme = EditorView.theme({
  '&': {
    display: 'grid !important',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    gridTemplateRows: 'auto minmax(0, 1fr) auto',
    height: '100%',
    backgroundColor: 'transparent',
    color: 'var(--foreground)',
    fontSize: '14px',
    fontFamily: MONO_FONT_FAMILY,
  },
  '& > .cm-panels-top': {
    gridColumn: '1 / -1',
    gridRow: '1',
  },
  '& > .cm-scroller': {
    gridColumn: '1',
    gridRow: '2',
    minWidth: '0',
    minHeight: '0',
    height: '100%',
  },
  '& > [data-testid="code-minimap"]': {
    gridColumn: '2',
    gridRow: '2',
    minHeight: '0',
    height: '100%',
  },
  '& > .cm-panels-bottom': {
    gridColumn: '1 / -1',
    gridRow: '3',
  },
  '&, &.cm-focused, &:focus, &:focus-visible': {
    outline: 'none !important',
    boxShadow: 'none !important',
  },
  '.cm-scroller:focus, .cm-scroller:focus-visible, .cm-content:focus, .cm-content:focus-visible, .cm-gutters:focus, .cm-gutters:focus-visible': {
    outline: 'none !important',
    boxShadow: 'none !important',
  },
  '.cm-scroller': {
    overflow: 'auto',
    lineHeight: '1.625',
    fontFamily: MONO_FONT_FAMILY,
    paddingTop: '8px',
    paddingBottom: '8px',
  },
  '&[data-has-minimap="true"] .cm-scroller::-webkit-scrollbar:vertical': {
    width: '0px',
    display: 'none',
  },
  '.cm-scroller[data-scrolled-x="true"] .cm-content': {
    clipPath: 'inset(0 0 0 var(--cm-scroll-x, 0px))',
  },
  '.cm-scroller[data-scrolled-x="true"] .cm-layer, .cm-scroller[data-scrolled-x="true"] .cm-comment-marks': {
    clipPath: 'inset(0 0 0 var(--cm-layer-clip-x, 0px))',
  },
  '.cm-gutters, .cm-gutter': {
    backgroundColor: 'transparent !important',
    borderRight: 'none',
  },
  '.cm-gutters': {
    color: 'color-mix(in oklch, var(--muted-foreground) 55%, transparent)',
    userSelect: 'none',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    padding: '0 4px 0 12px',
    minWidth: 'calc(2ch + 16px)',
    textAlign: 'right',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
    color: 'var(--foreground)',
  },
  '.cm-activeLine': {
    backgroundColor: 'color-mix(in oklch, var(--muted) 40%, transparent)',
  },
  '&:not(.cm-focused) .cm-activeLine': {
    backgroundColor: 'transparent',
  },
  '.cm-gutterElement.cm-gutter-has-diff': {
    cursor: 'pointer',
  },
  '.cm-gutterElement.cm-gutter-diff-added': {
    color: 'rgb(16 185 129)',
  },
  '.cm-gutterElement.cm-gutter-diff-modified': {
    color: 'rgb(245 158 11)',
  },
  '.cm-gutterElement.cm-gutter-diff-deleted': {
    color: 'rgb(244 63 94)',
  },
  '.cm-gutterElement.cm-gutter-has-diff:hover': {
    backgroundColor: 'color-mix(in oklch, var(--muted) 80%, transparent)',
  },
  '.cm-diff-markers': {
    width: '9px',
  },
  '.cm-diff-markers .cm-gutterElement': {
    padding: '0',
    position: 'relative',
    cursor: 'pointer',
  },
  '.cm-diff-bar': {
    display: 'block',
    width: '3px',
    height: '100%',
    marginLeft: '2px',
    borderRadius: '1px',
  },
  '.cm-diff-bar-added': {
    backgroundColor: 'rgb(16 185 129)',
  },
  '.cm-diff-bar-modified': {
    backgroundColor: 'rgb(245 158 11)',
  },
  '.cm-diff-del-wrap': {
    display: 'block',
    width: '100%',
    height: '100%',
    position: 'relative',
  },
  '.cm-diff-del': {
    width: '0',
    height: '0',
    borderTop: '4px solid transparent',
    borderBottom: '4px solid transparent',
    borderLeft: '6px solid rgb(244 63 94)',
    position: 'absolute',
    left: '1px',
  },
  '.cm-diff-del-above': {
    top: '0px',
  },
  '.cm-diff-del-below': {
    bottom: '0px',
  },
  '.cm-content': {
    padding: '0 12px 0 4px',
    caretColor: 'var(--foreground)',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--foreground)',
  },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'color-mix(in oklch, var(--primary) 24%, transparent) !important',
  },
  '.cm-selectionMatch': {
    backgroundColor: 'color-mix(in oklch, var(--primary) 14%, transparent)',
    borderRadius: '2px',
  },
  '&.cm-focused .cm-matchingBracket': {
    backgroundColor: 'color-mix(in oklch, var(--primary) 24%, transparent)',
    outline: '1px solid color-mix(in oklch, var(--primary) 45%, transparent)',
    borderRadius: '2px',
  },
  '.cm-flash-line': {
    backgroundColor: 'rgba(202, 138, 4, 0.25) !important',
  },
  '.cm-flash-line-fade': {
    backgroundColor: 'transparent',
    transition: 'background-color 1s ease',
  },
  '.cm-panels': {
    position: 'relative',
    backgroundColor: 'transparent',
    color: 'var(--foreground)',
  },
  '.cm-panels-top': {
    borderBottom: '1px solid var(--border)',
  },
  '.cm-panels-bottom': {
    borderTop: '1px solid var(--border)',
  },
  '.cm-panel.cm-search': {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 32px 6px 12px',
    fontSize: '12px',
    fontFamily: 'inherit',
    position: 'relative',
  },
  '.cm-panel.cm-search br': {
    flexBasis: '100%',
    height: '0',
  },
  '.cm-panel.cm-search input, .cm-panel.cm-search button, .cm-panel.cm-search label': {
    margin: '0',
  },
  '.cm-panel.cm-search [name="close"]': {
    position: 'absolute',
    top: '6px',
    right: '8px',
    width: '20px',
    height: '20px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '4px',
    color: 'var(--muted-foreground)',
    cursor: 'pointer',
    outline: 'none !important',
    boxShadow: 'none !important',
  },
  '.cm-panel.cm-search [name="close"]:hover': {
    backgroundColor: 'var(--muted)',
    color: 'var(--foreground)',
  },
  '.cm-textfield, .cm-textfield:focus, .cm-textfield:focus-visible': {
    backgroundColor: 'color-mix(in oklch, var(--muted) 45%, transparent)',
    color: 'var(--foreground)',
    border: '1px solid var(--border)',
    borderRadius: '6px',
    padding: '2px 8px',
    fontSize: '12px',
    outline: 'none !important',
    boxShadow: 'none !important',
  },
  '.cm-textfield:focus': {
    borderColor: 'var(--ring)',
  },
  '.cm-button, .cm-button:focus, .cm-button:focus-visible': {
    backgroundImage: 'none',
    backgroundColor: 'color-mix(in oklch, var(--muted) 65%, transparent)',
    color: 'var(--foreground)',
    border: '1px solid var(--border)',
    borderRadius: '6px',
    padding: '2px 8px',
    fontSize: '12px',
    cursor: 'pointer',
    outline: 'none !important',
    boxShadow: 'none !important',
  },
  '.cm-button:hover': {
    backgroundColor: 'var(--muted)',
  },
  '.cm-panel.cm-search label': {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    fontSize: '11px',
    color: 'var(--muted-foreground)',
    cursor: 'pointer',
  },
  '.cm-searchMatch': {
    backgroundColor: 'color-mix(in oklch, rgb(245 158 11) 28%, transparent)',
    outline: '1px solid color-mix(in oklch, rgb(245 158 11) 50%, transparent)',
    borderRadius: '2px',
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'color-mix(in oklch, rgb(245 158 11) 50%, transparent)',
    outline: '1px solid rgb(245 158 11)',
  },
})
