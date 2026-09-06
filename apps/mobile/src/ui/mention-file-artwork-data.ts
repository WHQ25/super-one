import data from './mention-artwork.generated.json'
import { fileIconId } from './file-icon-data'

const variants: Record<string, Record<string, string>> = data.variants
const images: Record<string, string> = data.images

export function mentionFileArtwork(path: string, directory: boolean, foreground: string): string | undefined {
  const ink = variants[foreground]
  const id = ink?.[fileIconId(path, directory)]
  return id ? images[id] : undefined
}

