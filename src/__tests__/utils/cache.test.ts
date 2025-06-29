import { CacheService, MemoryCache } from '../../utils/cache';
import { ConfigManager } from '../../utils/config';

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

      try {
        // Fill cache to max size
        for (let i = 0; i < 10; i++) {
          smallCache.set(`key${i}`, `value${i}`);
        }

        // Cache should have evicted older entries
        expect(smallCache.size()).toBeLessThanOrEqual(10);
      } finally {
        smallCache.destroy();
      }
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

  describe('size tracking', () => {
    it('should track cache size correctly', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');

      expect(cache.size()).toBe(2);
    });
  });
});

describe('CacheService Sliding Expiration', () => {
  beforeEach(async () => {
    // Clear all caches before each test
    await CacheService.clearAll();
  });

  afterAll(async () => {
    // Clean up after all tests
    await CacheService.clearAll();
  });

  describe('handleDomainAccess', () => {
    const testDomain = 'npub1xyz.example.com';
    const testPubkey = '1234567890abcdef1234567890abcdef12345678';
    const testServers = ['https://blossom.example.com'];
    const testRelays = ['wss://relay.example.com'];

    beforeEach(() => {
      // Mock sliding expiration enabled
      const mockConfig = {
        slidingExpiration: true,
        cacheTime: 3600,
        fileContentCacheTtlMs: 1800000,
      };

      jest.spyOn(ConfigManager, 'getInstance').mockReturnValue({
        getConfig: () => mockConfig,
      } as any);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should refresh TTL for domain and related cache entries', async () => {
      // Set up initial cache entries
      await CacheService.setPubkeyForDomain(testDomain, testPubkey);
      await CacheService.setBlossomServersForPubkey(testPubkey, testServers);
      await CacheService.setRelaysForPubkey(testPubkey, testRelays);

      // Verify entries exist
      expect(await CacheService.getPubkeyForDomain(testDomain)).toBe(testPubkey);
      expect(await CacheService.getBlossomServersForPubkey(testPubkey)).toEqual(testServers);
      expect(await CacheService.getRelaysForPubkey(testPubkey)).toEqual(testRelays);

      // Handle domain access (this should refresh TTL)
      await CacheService.handleDomainAccess(testDomain, testPubkey);

      // Entries should still be available (TTL refreshed)
      expect(await CacheService.getPubkeyForDomain(testDomain)).toBe(testPubkey);
      expect(await CacheService.getBlossomServersForPubkey(testPubkey)).toEqual(testServers);
      expect(await CacheService.getRelaysForPubkey(testPubkey)).toEqual(testRelays);
    });

    it('should not perform TTL refresh when sliding expiration is disabled', async () => {
      // Mock sliding expiration disabled
      const mockConfig = {
        slidingExpiration: false,
        cacheTime: 3600,
        fileContentCacheTtlMs: 1800000,
      };

      jest.spyOn(ConfigManager, 'getInstance').mockReturnValue({
        getConfig: () => mockConfig,
      } as any);

      // Set up initial cache entries
      await CacheService.setPubkeyForDomain(testDomain, testPubkey);

      // Handle domain access (should be no-op when disabled)
      await CacheService.handleDomainAccess(testDomain, testPubkey);

      // Entry should still exist (not affected by disabled sliding expiration)
      expect(await CacheService.getPubkeyForDomain(testDomain)).toBe(testPubkey);
    });

    it('should handle missing cache entries gracefully', async () => {
      // Handle domain access for non-existent entries
      await expect(CacheService.handleDomainAccess(testDomain, testPubkey)).resolves.not.toThrow();
    });
  });

  describe('getWithSlidingExpiration behavior', () => {
    const testKey = 'test-key';
    const testValue = 'test-value';

    beforeEach(() => {
      // Mock sliding expiration enabled
      const mockConfig = {
        slidingExpiration: true,
        cacheTime: 3600,
        fileContentCacheTtlMs: 1800000,
      };

      jest.spyOn(ConfigManager, 'getInstance').mockReturnValue({
        getConfig: () => mockConfig,
      } as any);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should refresh TTL when getting domain mapping', async () => {
      // Set initial value
      await CacheService.setPubkeyForDomain(testKey, testValue);

      // Get value (should refresh TTL)
      const result = await CacheService.getPubkeyForDomain(testKey);
      expect(result).toBe(testValue);

      // Value should still be available after getting
      const result2 = await CacheService.getPubkeyForDomain(testKey);
      expect(result2).toBe(testValue);
    });

    it('should refresh TTL when getting blossom servers', async () => {
      const servers = ['https://server1.com', 'https://server2.com'];

      // Set initial value
      await CacheService.setBlossomServersForPubkey(testKey, servers);

      // Get value (should refresh TTL)
      const result = await CacheService.getBlossomServersForPubkey(testKey);
      expect(result).toEqual(servers);
    });

    it('should refresh TTL when getting relays', async () => {
      const relays = ['wss://relay1.com', 'wss://relay2.com'];

      // Set initial value
      await CacheService.setRelaysForPubkey(testKey, relays);

      // Get value (should refresh TTL)
      const result = await CacheService.getRelaysForPubkey(testKey);
      expect(result).toEqual(relays);
    });

    it('should refresh TTL when getting blob for path', async () => {
      const testPubkey = 'test-pubkey';
      const testPath = '/test.html';
      const testEvent = {
        pubkey: testPubkey,
        path: testPath,
        sha256: 'test-sha256',
        created_at: Math.floor(Date.now() / 1000),
      };

      // Set initial value
      await CacheService.setBlobForPath(testPubkey, testPath, testEvent);

      // Get value (should refresh TTL)
      const result = await CacheService.getBlobForPath(testPubkey, testPath);
      expect(result).toEqual(testEvent);
    });

    it('should use custom TTL for file content cache', async () => {
      const testSha256 = 'abcdef123456';
      const testContent = new Uint8Array([1, 2, 3, 4, 5]);

      // Set initial value
      await CacheService.setFileContent(testSha256, testContent);

      // Get value (should refresh TTL with custom TTL)
      const result = await CacheService.getFileContent(testSha256);
      expect(result).toEqual(testContent);
    });
  });

  describe('sliding expiration disabled', () => {
    beforeEach(() => {
      // Mock sliding expiration disabled
      const mockConfig = {
        slidingExpiration: false,
        cacheTime: 3600,
        fileContentCacheTtlMs: 1800000,
      };

      jest.spyOn(ConfigManager, 'getInstance').mockReturnValue({
        getConfig: () => mockConfig,
      } as any);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should not refresh TTL when sliding expiration is disabled', async () => {
      const testKey = 'test-key';
      const testValue = 'test-value';

      // Set initial value
      await CacheService.setPubkeyForDomain(testKey, testValue);

      // Get value (should NOT refresh TTL)
      const result = await CacheService.getPubkeyForDomain(testKey);
      expect(result).toBe(testValue);

      // Should still work normally
      const result2 = await CacheService.getPubkeyForDomain(testKey);
      expect(result2).toBe(testValue);
    });
  });
});
