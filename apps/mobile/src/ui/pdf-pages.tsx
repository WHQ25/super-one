import { PDF_VIEWER_HTML } from '../generated-pdf-viewer-html'
import { CachedFileViewer } from './cached-file-viewer'

/** A transferred PDF, every page in a scrolling, pinch-zoomable column drawn by the offline pdf.js viewer. */
export function PdfPages({ uri, name }: { uri: string; name: string }) {
  return <CachedFileViewer uri={uri} name={name} html={PDF_VIEWER_HTML} testID="pdf-preview-webview" zoomable />
}
