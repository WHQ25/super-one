export function invalidPhoneArgument(message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code: 'invalid_argument' })
}

export function phoneMethodText(p: Record<string, unknown>, key: string): string {
  const value = p[key]
  if (typeof value !== 'string' || !value) throw invalidPhoneArgument(`${key} is required`)
  return value
}

/** A string that may be empty. Absent or null becomes `fallback`. */
export function phoneMethodOptionalText(p: Record<string, unknown>, key: string, fallback = ''): string {
  const value = p[key]
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'string') throw invalidPhoneArgument(`${key} must be a string`)
  return value
}
