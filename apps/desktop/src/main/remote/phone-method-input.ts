export function invalidPhoneArgument(message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code: 'invalid_argument' })
}

export function phoneMethodText(p: Record<string, unknown>, key: string): string {
  const value = p[key]
  if (typeof value !== 'string' || !value) throw invalidPhoneArgument(`${key} is required`)
  return value
}
