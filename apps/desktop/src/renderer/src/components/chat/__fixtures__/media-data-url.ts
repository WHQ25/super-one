/** Serve fixture bytes through the same data-URI path used for remote previews. */
export async function mediaDataUrl(url: string, mimeType: string): Promise<string> {
  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer())
  return `data:${mimeType};base64,${btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''))}`
}
