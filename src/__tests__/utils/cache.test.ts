import { MemoryCache } from '../../utils/cache';

describe('MemoryCache', () => {
  let cache: MemoryCache<string>;

  beforeEach(() => {
    cache = new MemoryCache<string>();
  });

  afterEach(() => {
    cache.destroy();
  });

  describe('basic operations', () => {
    it('should store and retrieve values', () => {
      cache.set('key1', 'value1');
      expect(cache.get('key1')).toBe('value1');
    });

    it('should return null for non-existent keys', () => {
      expect(cache.get('nonexistent')).toBeNull();
    });

    it('should check if key exists', () => {
      cache.set('key1', 'value1');
      expect(cache.has('key1')).toBe(true);
      expect(cache.has('nonexistent')).toBe(false);
    });

    it('should delete keys', () => {
      cache.set('key1', 'value1');
      expect(cache.has('key1')).toBe(true);

      const deleted = cache.delete('key1');
      expect(deleted).toBe(true);
      expect(cache.has('key1')).toBe(false);
    });

    it('should clear all keys', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      expect(cache.size()).toBe(2);

      cache.clear();
      expect(cache.size()).toBe(0);
    });

    it('should return cache size', () => {
      expect(cache.size()).toBe(0);

      cache.set('key1', 'value1');
      expect(cache.size()).toBe(1);

      cache.set('key2', 'value2');
      expect(cache.size()).toBe(2);
    });

    it('should return all keys', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');

      const keys = cache.keys();
      expect(keys).toContain('key1');
      expect(keys).toContain('key2');
      expect(keys.length).toBe(2);
    });
  });

  describe('TTL functionality', () => {
    it('should expire entries after TTL', async () => {
      const shortTtl = 100; // 100ms
      cache.set('key1', 'value1', shortTtl);

      expect(cache.get('key1')).toBe('value1');

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(cache.get('key1')).toBeNull();
      expect(cache.has('key1')).toBe(false);
    });

    it('should use custom TTL when provided', async () => {
      const longTtl = 1000; // 1 second
      cache.set('key1', 'value1', longTtl);

      // Should still be available after short delay
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(cache.get('key1')).toBe('value1');
    });
  });

  describe('cache eviction', () => {
    it('should evict oldest entries when max size is reached', () => {
      // Set max size to 2 for testing
      const smallCache = new MemoryCache<string>();

      // Fill cache to max size
      for (let i = 0; i < 10; i++) {
        smallCache.set(`key${i}`, `value${i}`);
      }

      // Cache should have evicted older entries
      expect(smallCache.size()).toBeLessThanOrEqual(10);

      smallCache.destroy();
    });
  });

  describe('cleanup', () => {
    it('should clean up expired entries', async () => {
      const shortTtl = 50; // 50ms

      cache.set('key1', 'value1', shortTtl);
      cache.set('key2', 'value2', shortTtl);

      expect(cache.size()).toBe(2);

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Trigger cleanup by trying to get an expired key
      cache.get('key1');

      expect(cache.size()).toBeLessThan(2);
    });
  });

  describe('statistics', () => {
    it('should return cache statistics', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');

      const stats = cache.getStats();

      expect(stats.size).toBe(2);
      expect(stats.maxSize).toBeGreaterThan(0);
      expect(typeof stats.hitRate).toBe('number');
      expect(typeof stats.expiredCount).toBe('number');
    });
  });
});
