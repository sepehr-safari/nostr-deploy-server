import { CacheService } from '../../utils/cache';

// Mock the config to use in-memory cache for tests
jest.mock('../../utils/config', () => ({
  ConfigManager: {
    getInstance: jest.fn(() => ({
      getConfig: jest.fn(() => ({
        cachePath: 'in-memory',
        cacheTime: 60, // 1 minute for tests
        fileContentCacheTtlMs: 30000, // 30 seconds
        negativeCacheTtlMs: 10000, // 10 seconds
      })),
    })),
  },
}));

// Mock the logger to reduce noise during tests
jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('Advanced Caching System', () => {
  const testDomain = 'example.npub1xyz.com';
  const testPubkey = '1234567890abcdef1234567890abcdef12345678';
  const testPath = '/index.html';
  const testSha256 = 'abcdef1234567890abcdef1234567890abcdef12';

  beforeEach(() => {
    // Clear all caches before each test
    return CacheService.clearAll();
  });

  afterAll(() => {
    // Clean up after all tests
    return CacheService.clearAll();
  });

  describe('Domain Resolution Cache', () => {
    it('should cache and retrieve domain to pubkey mappings', async () => {
      // Set domain mapping
      await CacheService.setPubkeyForDomain(testDomain, testPubkey);

      // Retrieve domain mapping
      const cachedPubkey = await CacheService.getPubkeyForDomain(testDomain);

      expect(cachedPubkey).toBe(testPubkey);
    });

    it('should return null for non-existent domain', async () => {
      const cachedPubkey = await CacheService.getPubkeyForDomain('non-existent.domain');
      expect(cachedPubkey).toBeNull();
    });
  });

  describe('Blossom Servers Cache', () => {
    const blossomServers = [
      'https://cdn.hzrd149.com',
      'https://blossom.primal.net',
      'https://blossom.band',
    ];

    it('should cache and retrieve blossom servers for pubkey', async () => {
      // Set blossom servers
      await CacheService.setBlossomServersForPubkey(testPubkey, blossomServers);

      // Retrieve blossom servers
      const cachedServers = await CacheService.getBlossomServersForPubkey(testPubkey);

      expect(cachedServers).toEqual(blossomServers);
    });

    it('should return null for pubkey with no cached servers', async () => {
      const cachedServers = await CacheService.getBlossomServersForPubkey('non-existent-pubkey');
      expect(cachedServers).toBeNull();
    });
  });

  describe('Relay Lists Cache', () => {
    const relays = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net'];

    it('should cache and retrieve relays for pubkey', async () => {
      // Set relays
      await CacheService.setRelaysForPubkey(testPubkey, relays);

      // Retrieve relays
      const cachedRelays = await CacheService.getRelaysForPubkey(testPubkey);

      expect(cachedRelays).toEqual(relays);
    });

    it('should return null for pubkey with no cached relays', async () => {
      const cachedRelays = await CacheService.getRelaysForPubkey('non-existent-pubkey');
      expect(cachedRelays).toBeNull();
    });
  });

  describe('Path to Blob Mapping Cache', () => {
    const testEvent = {
      pubkey: testPubkey,
      path: testPath,
      sha256: testSha256,
      created_at: Math.floor(Date.now() / 1000),
    };

    it('should cache and retrieve blob events for path', async () => {
      // Set blob event
      await CacheService.setBlobForPath(testPubkey, testPath, testEvent);

      // Retrieve blob event
      const cachedEvent = await CacheService.getBlobForPath(testPubkey, testPath);

      expect(cachedEvent).toEqual(testEvent);
    });

    it('should return null for non-existent path', async () => {
      const cachedEvent = await CacheService.getBlobForPath(testPubkey, '/non-existent.html');
      expect(cachedEvent).toBeNull();
    });

    it('should invalidate blob cache for specific path', async () => {
      // Set blob event
      await CacheService.setBlobForPath(testPubkey, testPath, testEvent);

      // Verify it's cached
      let cachedEvent = await CacheService.getBlobForPath(testPubkey, testPath);
      expect(cachedEvent).toEqual(testEvent);

      // Invalidate cache
      await CacheService.invalidateBlobForPath(testPubkey, testPath);

      // Verify it's no longer cached
      cachedEvent = await CacheService.getBlobForPath(testPubkey, testPath);
      expect(cachedEvent).toBeNull();
    });
  });

  describe('Blob URLs Cache', () => {
    const testUrls = [
      `https://cdn.hzrd149.com/${testSha256}`,
      `https://blossom.primal.net/${testSha256}`,
    ];

    it('should cache and retrieve blob URLs', async () => {
      // Set blob URLs
      await CacheService.setBlobURLs(testSha256, testUrls);

      // Retrieve blob URLs
      const cachedUrls = await CacheService.getBlobURLs(testSha256);

      expect(cachedUrls).toEqual(testUrls);
    });

    it('should return null for non-existent blob', async () => {
      const cachedUrls = await CacheService.getBlobURLs('non-existent-sha256');
      expect(cachedUrls).toBeNull();
    });
  });

  describe('File Content Cache', () => {
    const testContent = new Uint8Array([72, 101, 108, 108, 111]); // "Hello" in bytes

    it('should cache and retrieve file content', async () => {
      // Set file content
      await CacheService.setFileContent(testSha256, testContent);

      // Retrieve file content
      const cachedContent = await CacheService.getFileContent(testSha256);

      // In test environment with mocked config, Uint8Array may be serialized as object
      // The important thing is that the content is preserved
      expect(cachedContent).toBeDefined();
      if (cachedContent instanceof Uint8Array) {
        expect(Array.from(cachedContent)).toEqual(Array.from(testContent));
      } else {
        // Handle serialized object case
        const values = Object.values(cachedContent as any);
        expect(values).toEqual(Array.from(testContent));
      }
    });

    it('should return null for non-existent file', async () => {
      const cachedContent = await CacheService.getFileContent('non-existent-sha256');
      expect(cachedContent).toBeNull();
    });
  });

  describe('Negative Cache', () => {
    const notFoundKey = 'not-found-key';

    it('should cache and retrieve negative results', async () => {
      // Set negative cache
      await CacheService.setNegativeCache(notFoundKey);

      // Check negative cache
      const isNegative = await CacheService.isNegativeCached(notFoundKey);

      expect(isNegative).toBe(true);
    });

    it('should return false for non-cached keys', async () => {
      const isNegative = await CacheService.isNegativeCached('non-cached-key');
      expect(isNegative).toBe(false);
    });
  });

  describe('Cache Statistics', () => {
    it('should return cache statistics', async () => {
      const stats = await CacheService.getStats();

      expect(stats).toHaveProperty('backend');
      expect(stats).toHaveProperty('initialized');
      expect(stats.backend).toBe('in-memory');
      expect(stats.initialized).toBe(true);
    });
  });

  describe('Cache Integration Tests', () => {
    it('should handle complex caching scenarios', async () => {
      // Set up complex test data
      const domain = 'test.example.com';
      const pubkey = 'test-pubkey-123';
      const path = '/complex/test.html';
      const sha256 = 'complex-test-sha256';
      const servers = ['https://server1.com', 'https://server2.com'];
      const relays = ['wss://relay1.com', 'wss://relay2.com'];
      const urls = [`https://server1.com/${sha256}`, `https://server2.com/${sha256}`];
      const event = { pubkey, path, sha256, created_at: Date.now() };
      const content = new Uint8Array([1, 2, 3, 4, 5]);

      // Cache all data types
      await Promise.all([
        CacheService.setPubkeyForDomain(domain, pubkey),
        CacheService.setBlossomServersForPubkey(pubkey, servers),
        CacheService.setRelaysForPubkey(pubkey, relays),
        CacheService.setBlobForPath(pubkey, path, event),
        CacheService.setBlobURLs(sha256, urls),
        CacheService.setFileContent(sha256, content),
      ]);

      // Verify all data is cached correctly
      const [cachedPubkey, cachedServers, cachedRelays, cachedEvent, cachedUrls, cachedContent] =
        await Promise.all([
          CacheService.getPubkeyForDomain(domain),
          CacheService.getBlossomServersForPubkey(pubkey),
          CacheService.getRelaysForPubkey(pubkey),
          CacheService.getBlobForPath(pubkey, path),
          CacheService.getBlobURLs(sha256),
          CacheService.getFileContent(sha256),
        ]);

      expect(cachedPubkey).toBe(pubkey);
      expect(cachedServers).toEqual(servers);
      expect(cachedRelays).toEqual(relays);
      expect(cachedEvent).toEqual(event);
      expect(cachedUrls).toEqual(urls);

      // Handle Uint8Array serialization in test environment
      expect(cachedContent).toBeDefined();
      if (cachedContent instanceof Uint8Array) {
        expect(Array.from(cachedContent)).toEqual(Array.from(content));
      } else {
        const values = Object.values(cachedContent as any);
        expect(values).toEqual(Array.from(content));
      }
    });
  });
});
