export class LazyMap<K, V> {
  private _map: Map<K, V> = new Map();

  private constructor(private _valueFactory: (key: K) => V) {}

  static onCacheMiss<K, V>(valueFactory: (key: K) => V): LazyMap<K, V> {
    return new LazyMap(valueFactory);
  }

  static onCacheMissAsync<K, V>(
    valueFactory: (key: K) => Thenable<V>,
  ): LazyMap<K, Thenable<V>> {
    return new LazyMap(valueFactory);
  }

  set(key: K, value: V): void {
    if (value === undefined) {
      this._map.delete(key);
      return;
    }
    this._map.set(key, value);
  }

  get(key: K): V {
    let value = this._map.get(key);
    if (value === undefined) {
      value = this._valueFactory(key);
      if (value === undefined) {
        return undefined as V;
      }
      this._map.set(key, value);
    }
    return value;
  }

  has(key: K): boolean {
    return this._map.has(key);
  }

  delete(key: K): boolean {
    return this._map.delete(key);
  }

  clear(): void {
    this._map.clear();
  }

  keys(): IterableIterator<K> {
    return this._map.keys();
  }

  values(): IterableIterator<V> {
    return this._map.values();
  }

  entries(): IterableIterator<[K, V]> {
    return this._map.entries();
  }

  get size(): number {
    return this._map.size;
  }
}
