/**
 * Composer images, from SuperOne's wire shape to a dsh `ImageBlock`.
 *
 * dsh does not carry image bytes inline. An admitted image is written ONCE into
 * the content-addressed attachment store and every later reference to it — the
 * user message block, the durable log, each request the adapter serializes — is
 * a `ImageAttachmentRef`. That is why admission and block construction belong
 * together here: the block cannot be built before the bytes are committed.
 *
 * This module lives apart from `runtime.ts` because that file is already large
 * and this is a self-contained boundary: SuperOne's `ImageAttachment` in, dsh's
 * `ImageBlock` out, with the one capability check that must happen in between.
 */

import { admitEncodedImages, type AttachmentStore, type EncodedImageAttachment, type ImageMediaType } from '@deepseek-ai/dsh-attachment'
import type { ImageBlock, ModelModality } from '@deepseek-ai/dsh-llm'
import type { ImageAttachment } from '@superone/shared/agent-types'

/** The media types dsh admits; anything else is refused before the store sees it. */
const SUPPORTED_MEDIA_TYPES = new Set<string>(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

/**
 * Whether a resolved model route accepts image input.
 *
 * Reads the same field the DeepSeek adapter enforces at serialization
 * (`inputModalities`), so the check here and the adapter's refusal can never
 * disagree about a model. `undefined` means the route disclosed no modality
 * information at all, which upstream treats as text-only — and so does this.
 */
export function modelAcceptsImages(inputModalities: readonly ModelModality[] | undefined): boolean {
  return inputModalities?.includes('image') === true
}

/**
 * Project SuperOne's composer attachments onto dsh's wire form.
 *
 * An attachment whose media type dsh does not admit is dropped here rather than
 * at the store, because the store's refusal is an exception and this is an
 * ordinary "the composer allowed something this provider cannot take" case.
 * @param images - the composer's attachments, in message order.
 * @returns the admissible subset, order preserved.
 */
export function encodeComposerImages(
  images: readonly ImageAttachment[],
): EncodedImageAttachment[] {
  const encoded: EncodedImageAttachment[] = []
  for (const image of images) {
    if (!image.base64) continue
    if (!SUPPORTED_MEDIA_TYPES.has(image.mimeType)) continue
    encoded.push({
      mediaType: image.mimeType as ImageMediaType,
      data: image.base64,
      // dsh never interprets this as a path, but an empty string is not a name.
      ...(image.name ? { name: image.name } : {}),
    })
  }
  return encoded
}

/**
 * Commit images to the store and return the blocks that reference them.
 *
 * `admitEncodedImages` is upstream's own admission entry: it enforces canonical
 * base64, then delegates count, aggregate-byte, dimension and media-type policy
 * to the store, committing the batch in order or committing none of it. A
 * refusal therefore leaves nothing durable behind, which is the property the
 * caller depends on — see `DeepseekRuntime.sendText`.
 * @param store - the mounted attachment store.
 * @param images - already-projected wire images.
 * @returns one `ImageBlock` per input, in the same order.
 */
export async function admitImageBlocks(
  store: AttachmentStore,
  images: readonly EncodedImageAttachment[],
): Promise<ImageBlock[]> {
  const refs = await admitEncodedImages(store, images)
  return refs.map((attachment) => ({ type: 'image', attachment }))
}
