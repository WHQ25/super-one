/** Flatten a fetch Headers object into the plain record the AI SDK reports back for telemetry. */
export function collectHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {}
  headers.forEach((value, key) => {
    out[key] = value
  })
  return out
}

/** Drop the undefined entries the SDK allows in call-level headers so fetch never sees them. */
export function definedHeaders(headers: Record<string, string | undefined> | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (value != null) out[key] = value
  }
  return out
}

/** Parse a JSON response, keeping the raw body in the error so non-JSON gateway pages stay diagnosable. */
export async function readJson<T>(response: Response, label: string): Promise<T> {
  const raw = await response.text()
  try {
    return JSON.parse(raw) as T
  } catch {
    throw new Error(`${label} returned a non-JSON response (${response.status}): ${raw.slice(0, 300)}`)
  }
}
