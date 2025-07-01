import { CacheInvalidationService } from '../../helpers/cache-invalidation';
import { CacheService } from '../../utils/cache';
import { ConfigManager } from '../../utils/config';
import { logger } from '../../utils/logger';

// Mock dependencies with proper setup
jest.mock('../../utils/config', () => ({
  ConfigManager: {
    getInstance: jest.fn().mockReturnValue({
      getConfig: jest.fn().mockReturnValue({
        logLevel: 'info',
        realtimeCacheInvalidation: false,
        invalidationRelays: [],
        invalidationTimeoutMs: 30000,
        invalidationReconnectDelayMs: 5000,
      }),
    }),
  },
}));

jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('../../utils/cache');
jest.mock('nostr-tools', () => ({
  SimplePool: jest.fn().mockImplementation(() => ({
    subscribeMany: jest.fn(),
    close: jest.fn(),
  })),
}));
jest.mock('websocket-polyfill');

const mockCacheService = CacheService as jest.Mocked<typeof CacheService>;

describe('CacheInvalidationService', () => {
  let mockConfig: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup test-specific mock configuration
    mockConfig = {
      realtimeCacheInvalidation: true,
      invalidationRelays: ['wss://relay.primal.net', 'wss://relay.damus.io'],
      invalidationTimeoutMs: 30000,
      invalidationReconnectDelayMs: 5000,
      defaultRelays: ['wss://relay.primal.net', 'wss://nos.lol'],
      defaultBlossomServers: ['https://blossom.primal.net', 'https://cdn.satellite.earth'],
    };

    // Update the mock to return our test config
    (ConfigManager.getInstance as jest.Mock).mockReturnValue({
      getConfig: jest.fn().mockReturnValue(mockConfig),
    });

    // Logger is already mocked at module level

    // Setup cache service mocks
    mockCacheService.invalidateBlobForPath = jest.fn().mockResolvedValue(undefined);
    mockCacheService.invalidateRelaysForPubkey = jest.fn().mockResolvedValue(undefined);
    mockCacheService.invalidateBlossomServersForPubkey = jest.fn().mockResolvedValue(undefined);
    mockCacheService.invalidateAllForPubkey = jest.fn().mockResolvedValue(undefined);
    mockCacheService.invalidateNegativeCache = jest.fn().mockResolvedValue(undefined);

    // Add new cache update methods
    mockCacheService.setBlobForPath = jest.fn().mockResolvedValue(undefined);
    mockCacheService.setRelaysForPubkey = jest.fn().mockResolvedValue(undefined);
    mockCacheService.setBlossomServersForPubkey = jest.fn().mockResolvedValue(undefined);
  });

  describe('Initialization', () => {
    it('should initialize service when real-time invalidation is enabled', () => {
      const service = new CacheInvalidationService();
      const stats = service.getStats();

      expect(stats.enabled).toBe(true);
      expect(logger.info).toHaveBeenCalledWith('Real-time cache invalidation service enabled');
    });

    it('should not initialize service when real-time invalidation is disabled', () => {
      mockConfig.realtimeCacheInvalidation = false;

      const service = new CacheInvalidationService();
      const stats = service.getStats();

      expect(stats.enabled).toBe(false);
      expect(logger.info).toHaveBeenCalledWith('Real-time cache invalidation service disabled');
    });

    it('should use configured relays for invalidation', () => {
      const service = new CacheInvalidationService();
      const stats = service.getStats();

      expect(stats.relays).toEqual(['wss://relay.primal.net', 'wss://relay.damus.io']);
    });
  });

  describe('Event Handling', () => {
    let service: CacheInvalidationService;

    beforeEach(() => {
      service = new CacheInvalidationService();
    });

    it('should handle static file events and update path cache', async () => {
      const mockEvent = {
        pubkey: 'test-pubkey-123',
        tags: [
          ['d', '/index.html'],
          ['x', 'abcdef1234567890'],
        ],
        kind: 34128,
        created_at: Math.floor(Date.now() / 1000),
        content: '',
        id: 'event-id',
        sig: 'signature',
      };

      const handleStaticFileEvent = (service as any).handleStaticFileEvent.bind(service);
      await handleStaticFileEvent(mockEvent);

      expect(mockCacheService.setBlobForPath).toHaveBeenCalledWith(
        'test-pubkey-123',
        '/index.html',
        {
          pubkey: 'test-pubkey-123',
          path: '/index.html',
          sha256: 'abcdef1234567890',
          created_at: mockEvent.created_at,
        }
      );
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringMatching(/✅ Cache UPDATED for static file: \/index\.html by test-pub.*/)
      );
    });

    it('should handle static file events without SHA256 and invalidate cache', async () => {
      const mockEvent = {
        pubkey: 'test-pubkey-no-hash',
        tags: [
          ['d', '/no-hash.html'],
          // Missing 'x' tag with SHA256
        ],
        kind: 34128,
        created_at: Math.floor(Date.now() / 1000),
        content: '',
        id: 'event-id-no-hash',
        sig: 'signature',
      };

      const handleStaticFileEvent = (service as any).handleStaticFileEvent.bind(service);
      await handleStaticFileEvent(mockEvent);

      expect(mockCacheService.invalidateBlobForPath).toHaveBeenCalledWith(
        'test-pubkey-no-hash',
        '/no-hash.html'
      );
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringMatching(/missing 'x' tag with SHA256 hash/)
      );
    });

    it('should handle relay list events and update relay cache', async () => {
      const mockEvent = {
        pubkey: 'test-pubkey-456',
        tags: [
          ['r', 'wss://relay1.com', 'read'],
          ['r', 'wss://relay2.com'],
          ['r', 'wss://relay3.com', 'write'], // Should be ignored
        ],
        kind: 10002,
        created_at: Date.now(),
        content: '',
        id: 'relay-event-id',
        sig: 'signature',
      };

      const handleRelayListEvent = (service as any).handleRelayListEvent.bind(service);
      await handleRelayListEvent(mockEvent);

      expect(mockCacheService.setRelaysForPubkey).toHaveBeenCalledWith('test-pubkey-456', [
        'wss://relay1.com',
        'wss://relay2.com',
      ]);
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringMatching(/✅ Relay list cache UPDATED for test-pub.*/)
      );
    });

    it('should handle blossom server events and update server cache', async () => {
      const mockEvent = {
        pubkey: 'test-pubkey-789',
        tags: [
          ['server', 'https://blossom1.com'],
          ['server', 'https://blossom2.com'],
        ],
        kind: 10063,
        created_at: Date.now(),
        content: '',
        id: 'blossom-event-id',
        sig: 'signature',
      };

      const handleBlossomServerEvent = (service as any).handleBlossomServerEvent.bind(service);
      await handleBlossomServerEvent(mockEvent);

      expect(mockCacheService.setBlossomServersForPubkey).toHaveBeenCalledWith('test-pubkey-789', [
        'https://blossom1.com',
        'https://blossom2.com',
      ]);
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringMatching(/✅ Blossom server cache UPDATED for test-pub.*/)
      );
    });

    it('should handle errors during event processing gracefully', async () => {
      mockCacheService.invalidateBlobForPath.mockRejectedValue(new Error('Cache error'));

      const mockEvent = {
        pubkey: 'test-pubkey-error',
        tags: [['d', '/error.html']],
        kind: 34128,
        created_at: Date.now(),
        content: '',
        id: 'event-id',
        sig: 'signature',
      };

      const handleStaticFileEvent = (service as any).handleStaticFileEvent.bind(service);
      await handleStaticFileEvent(mockEvent);

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringMatching(/❌ Error handling static file event for cache invalidation:/),
        expect.any(Error)
      );
    });
  });

  describe('Statistics', () => {
    it('should provide service statistics', () => {
      const service = new CacheInvalidationService();
      const stats = service.getStats();

      expect(stats).toMatchObject({
        enabled: true,
        connectedRelays: expect.any(Number),
        activeSubscriptions: expect.any(Number),
        relays: expect.any(Array),
      });
    });

    it('should show disabled state when service is disabled', () => {
      mockConfig.realtimeCacheInvalidation = false;
      const service = new CacheInvalidationService();
      const stats = service.getStats();

      expect(stats.enabled).toBe(false);
    });
  });

  describe('Graceful Shutdown', () => {
    it('should shutdown gracefully', async () => {
      const service = new CacheInvalidationService();

      await service.shutdown();

      expect(logger.info).toHaveBeenCalledWith('Shutting down cache invalidation service...');
      expect(logger.info).toHaveBeenCalledWith('Cache invalidation service shutdown complete');
    });

    it('should handle shutdown errors gracefully', async () => {
      const service = new CacheInvalidationService();

      // Mock error during shutdown
      const mockPool = (service as any).pool;
      mockPool.close = jest.fn().mockImplementation(() => {
        throw new Error('Shutdown error');
      });

      await service.shutdown();

      expect(logger.error).toHaveBeenCalledWith(
        'Error closing invalidation relay connections:',
        expect.any(Error)
      );
    });
  });

  describe('Configuration Validation', () => {
    it('should handle empty relay list when service is enabled', () => {
      mockConfig.invalidationRelays = [];

      const service = new CacheInvalidationService();
      const stats = service.getStats();

      expect(stats.relays).toEqual([]);
      // Service should still be marked as enabled even with no relays
      expect(stats.enabled).toBe(true);
    });

    it('should use default configuration values', () => {
      // Test that default values are used when environment variables are not set
      const service = new CacheInvalidationService();

      expect(ConfigManager.getInstance).toHaveBeenCalled();
    });
  });

  describe('Reconnection Logic', () => {
    it('should schedule reconnection on subscription close', async () => {
      jest.useFakeTimers();

      const service = new CacheInvalidationService();
      const scheduleReconnect = (service as any).scheduleReconnect.bind(service);

      scheduleReconnect();

      // Fast forward time
      jest.advanceTimersByTime(5000);

      expect(logger.info).toHaveBeenCalledWith('Attempting to reconnect invalidation service...');

      jest.useRealTimers();
    });

    it('should not reconnect when service is shutting down', async () => {
      jest.useFakeTimers();

      const service = new CacheInvalidationService();
      (service as any).isShuttingDown = true;

      const scheduleReconnect = (service as any).scheduleReconnect.bind(service);
      scheduleReconnect();

      jest.advanceTimersByTime(10000);

      // Should not attempt to reconnect
      expect(logger.info).not.toHaveBeenCalledWith(
        'Attempting to reconnect invalidation service...'
      );

      jest.useRealTimers();
    });
  });
});
