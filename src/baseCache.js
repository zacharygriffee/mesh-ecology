function createBaseCache({ maxSize = 20 }) {
  const cache = new Map();

  async function get(key, loader) {
    if (cache.has(key)) {
      const entry = cache.get(key);
      cache.delete(key);
      cache.set(key, entry);
      return entry.base;
    }

    const { base, cleanup } = await loader();
    cache.set(key, { base, cleanup });

    if (cache.size > maxSize) {
      const [oldKey, oldEntry] = cache.entries().next().value;
      cache.delete(oldKey);
      if (oldEntry?.cleanup) await oldEntry.cleanup(oldEntry.base);
    }

    return base;
  }

  async function clear() {
    for (const [, entry] of cache) {
      if (entry?.cleanup) await entry.cleanup(entry.base);
    }
    cache.clear();
  }

  return { get, clear, size: () => cache.size };
}

export { createBaseCache };
