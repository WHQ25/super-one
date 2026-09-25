import { MODEL_EXTENSIONS, extensionOf } from './file-preview'

/**
 * Symbols has no 3D file icons. Format logos come from vscode-icons (MIT, Copyright (c) 2016
 * Roberto Huertas) with its extension mapping; other formats use the `3d` icon from Material
 * Icon Theme (MIT, Copyright (c) 2025 Material Extensions).
 * https://github.com/vscode-icons/vscode-icons/tree/master/icons
 * https://github.com/material-extensions/vscode-material-icon-theme/blob/main/icons/3d.svg
 */
const GENERIC_MODEL_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#29b6f6" d="M21 16.5c0 .38-.21.71-.53.88l-7.9 4.44c-.16.12-.36.18-.57.18s-.41-.06-.57-.18l-7.9-4.44A.99.99 0 0 1 3 16.5v-9c0-.38.21-.71.53-.88l7.9-4.44c.16-.12.36-.18.57-.18s.41.06.57.18l7.9 4.44c.32.17.53.5.53.88zM12 4.15 6.04 7.5 12 10.85l5.96-3.35zM5 15.91l6 3.38v-6.71L5 9.21zm14 0v-6.7l-6 3.37v6.71z"/></svg>'
const GLTF_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path fill="#86c540" d="M29.3 12.91v.62h-.2v-.8h.31l.14.53.14-.54H30v.8h-.2v-.6l-.17.6h-.16zm-.74.62v-.63h-.24v-.18H29v.18h-.24v.63zm-13.62-2.44h1.07v8.1h-1.07zm9.62 8.11h-1.53v-6.49h4.73v1.32h-3.2v1.21h2.8v1.32h-2.8zm-4.26 0h-1.53v-5.17h-1.92V12.7h5.38v1.32H20.3zm-6.5 2.44a6.42 6.42 0 0 1-3.2 1.45c1 .18 2.05.27 3.14.27 4.22 0 7.92-1.47 9.99-3.57-1.9 1.25-4.73 1.96-7.89 1.96-.75 0-1.33-.02-2.03-.1zm-.49-.61c.49-.54.74-1.33.74-2.4v-5.95h-1.02v.93h-.01a1.9 1.9 0 0 0-.8-.81 2.89 2.89 0 0 0-2.55.05c-.39.21-.7.48-.93.82-.24.34-.4.7-.5 1.1a4.88 4.88 0 0 0 .03 2.46c.12.4.3.75.54 1.05a2.62 2.62 0 0 0 2.18.98 2.54 2.54 0 0 0 1.18-.3 1.96 1.96 0 0 0 .84-.88h.02v.43c0 .37-.03.7-.1 1-.08.3-.19.56-.35.78-.16.21-.36.38-.6.5-.25.12-.54.18-.9.18a2.88 2.88 0 0 1-.96-.18h-.02c-2.76-1.04-4.58-2.8-4.58-4.79 0-3.18 4.62-5.76 10.32-5.76 3.17 0 6.02.73 7.91 1.99-2.06-2.11-5.77-3.6-10-3.6C7.26 8.64 2 11.94 2 16c0 2.77 2.45 5.19 6.07 6.44 2.9.1 4.37-.44 5.24-1.41zm-.43-4.33c-.08.3-.19.58-.34.82a1.73 1.73 0 0 1-1.5.8c-.34 0-.64-.08-.87-.23a1.7 1.7 0 0 1-.57-.57 2.5 2.5 0 0 1-.3-.8 4.5 4.5 0 0 1 .02-1.78c.07-.28.18-.54.34-.76a1.71 1.71 0 0 1 1.48-.71c.33 0 .62.06.85.2.23.13.43.31.57.53.15.23.25.48.32.75a3.58 3.58 0 0 1 0 1.75z"/></svg>'
const FBX_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><polyline points="16.597 2 8.252 6.378 7.881 9.082 7.895 27.447 16.419 30" style="fill:#008f90;opacity:0.75"/><polygon points="7.895 11.896 7.895 14.929 13.33 17.675 16.487 19.706 16.53 11.889 7.895 11.896" style="fill:#00393a"/><polygon points="16.53 11.889 16.487 19.706 23.391 17.043 24.146 11.882 16.53 11.889" style="fill:#008f90"/><polygon points="8.225 6.378 7.854 9.069 16.556 8.464 16.597 2 8.225 6.378" style="fill:#004748"/><polygon points="22.375 3.222 16.597 2 16.556 8.464 24.105 7.188 22.375 3.222" style="fill:#009b9d"/><polygon points="8.252 6.378 7.881 9.082 7.895 27.447 16.542 11.896 8.252 6.378" style="fill:#002526;opacity:0.7"/><polygon points="7.895 27.447 12.63 28.861 16.419 30 16.542 11.896 7.895 27.447" style="fill:#006c6e;opacity:0.5"/></svg>'

const MODEL_ICON_SVGS: Readonly<Record<string, string>> = {
  '.glb': GLTF_ICON_SVG,
  '.gltf': GLTF_ICON_SVG,
  '.fbx': FBX_ICON_SVG,
}

const dataUris = new Map<string, string>()

/** Shared by desktop and the mobile SVG renderer; undefined for non-model files. */
export function modelFileIconSvg(name: string): string | undefined {
  const ext = extensionOf(name)
  if (!MODEL_EXTENSIONS.has(ext)) return undefined
  return MODEL_ICON_SVGS[ext] ?? GENERIC_MODEL_ICON_SVG
}

export function modelFileIconDataUri(name: string): string | undefined {
  const svg = modelFileIconSvg(name)
  if (!svg) return undefined
  let uri = dataUris.get(svg)
  if (!uri) {
    uri = `data:image/svg+xml,${encodeURIComponent(svg)}`
    dataUris.set(svg, uri)
  }
  return uri
}
