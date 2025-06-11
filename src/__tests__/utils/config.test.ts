import { ConfigManager } from '../../utils/config';

describe('ConfigManager', () => {
  let configManager: ConfigManager;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };

    // Reset the singleton instance
    (ConfigManager as any).instance = undefined;

    // Set test environment variables
    process.env.PORT = '3001';
    process.env.BASE_DOMAIN = 'test.example.com';
    process.env.CACHE_TTL_SECONDS = '60';
    process.env.MAX_CACHE_SIZE = '10';

    // Get fresh instance
    configManager = ConfigManager.getInstance();
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe('getInstance', () => {
    it('should return singleton instance', () => {
      const instance1 = ConfigManager.getInstance();
      const instance2 = ConfigManager.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('getConfig', () => {
    it('should return default configuration', () => {
      const config = configManager.getConfig();

      expect(config.port).toBe(3001); // From test setup
      expect(config.baseDomain).toBe('test.example.com'); // From test setup
      expect(config.defaultRelays).toEqual([
        'wss://nos.lol',
        'wss://ditto.pub/relay',
        'wss://relay.damus.io',
      ]);
      expect(config.defaultBlossomServers).toEqual([
        'https://cdn.hzrd149.com',
        'https://nostr.download',
      ]);
      expect(config.cacheTtlSeconds).toBe(60); // From test setup
      expect(config.maxCacheSize).toBe(10); // From test setup
    });
  });

  describe('updateConfig', () => {
    it('should update configuration', () => {
      const updates = {
        port: 4000,
        cacheTtlSeconds: 120,
      };

      configManager.updateConfig(updates);
      const config = configManager.getConfig();

      expect(config.port).toBe(4000);
      expect(config.cacheTtlSeconds).toBe(120);
      expect(config.baseDomain).toBe('test.example.com'); // Should remain unchanged
    });
  });

  describe('validation', () => {
    it('should throw error for invalid port', () => {
      // Create a new instance to isolate validation
      (ConfigManager as any).instance = undefined;
      process.env.PORT = '0'; // Invalid port

      expect(() => {
        ConfigManager.getInstance();
      }).toThrow('Invalid port: 0. Must be between 1-65535');

      // Reset for next test
      process.env.PORT = '3001';
    });

    it('should throw error for missing base domain', () => {
      // Create a new instance to isolate validation
      (ConfigManager as any).instance = undefined;
      delete process.env.BASE_DOMAIN; // Remove domain entirely

      expect(() => {
        ConfigManager.getInstance();
      }).toThrow('BASE_DOMAIN is required');

      // Reset for next test
      process.env.BASE_DOMAIN = 'test.example.com';
    });

    it('should throw error for invalid relay URL', () => {
      // Create a new instance to isolate validation
      (ConfigManager as any).instance = undefined;
      process.env.DEFAULT_RELAYS = 'http://invalid-relay.com';

      expect(() => {
        ConfigManager.getInstance();
      }).toThrow('Invalid relay URL');

      // Reset for next test
      delete process.env.DEFAULT_RELAYS;
    });

    it('should throw error for invalid Blossom server URL', () => {
      // Create a new instance to isolate validation
      (ConfigManager as any).instance = undefined;
      process.env.DEFAULT_BLOSSOM_SERVERS = 'wss://invalid-server.com';

      expect(() => {
        ConfigManager.getInstance();
      }).toThrow('Invalid Blossom server URL');

      // Reset for next test
      delete process.env.DEFAULT_BLOSSOM_SERVERS;
    });

    it('should throw error for negative cache TTL', () => {
      // Create a new instance to isolate validation
      (ConfigManager as any).instance = undefined;
      process.env.CACHE_TTL_SECONDS = '-1';

      expect(() => {
        ConfigManager.getInstance();
      }).toThrow('Cache TTL cannot be negative');

      // Reset for next test
      process.env.CACHE_TTL_SECONDS = '60';
    });
  });

  describe('environment detection', () => {
    it('should detect test environment', () => {
      expect(configManager.isTest()).toBe(true);
      expect(configManager.isDevelopment()).toBe(false);
      expect(configManager.isProduction()).toBe(false);
    });
  });
});
