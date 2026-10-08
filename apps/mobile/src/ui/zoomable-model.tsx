import { MODEL_VIEWER_HTML } from '../generated-model-viewer-html'
import { CachedFileViewer } from './cached-file-viewer'

/** A transferred glTF / GLB / STL / OBJ model, orbitable in the offline three.js viewer. */
export function ZoomableModel({ uri, name }: { uri: string; name: string }) {
  return <CachedFileViewer uri={uri} name={name} html={MODEL_VIEWER_HTML} testID="model-preview-webview" />
}
