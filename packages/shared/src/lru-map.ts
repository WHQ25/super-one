/**
 * Count-bounded map, optionally also bounded by the total `weigh` of its values;
 * reads promote the entry to the most recently used end. A value heavier than
 * the whole budget is not kept.
 */
export class LruMap<K, V> extends Map<K, V> {
  private weight = 0

  constructor(
    private readonly capacity: number,
    private readonly budget?: { max: number; weigh: (value: V) => number },
  ) { super() }

  override get(key: K): V | undefined {
    const value = super.get(key)
    if (super.has(key)) { super.delete(key); super.set(key, value!) }
    return value
  }

  override set(key: K, value: V): this {
    this.delete(key)
    super.set(key, value)
    if (this.budget) this.weight += this.budget.weigh(value)
    while (this.size > this.capacity || (this.budget && this.weight > this.budget.max)) this.delete(this.keys().next().value!)
    return this
  }

  override delete(key: K): boolean {
    if (this.budget && super.has(key)) this.weight -= this.budget.weigh(super.get(key)!)
    return super.delete(key)
  }

  override clear(): void {
    this.weight = 0
    super.clear()
  }
}
