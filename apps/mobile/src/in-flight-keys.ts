export class InFlightKeys {
  private readonly keys = new Set<string>()

  acquire(key: string): boolean {
    if (this.keys.has(key)) return false
    this.keys.add(key)
    return true
  }

  release(key: string): void {
    this.keys.delete(key)
  }
}
