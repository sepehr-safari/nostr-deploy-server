import { CacheService } from './cache';
import { logger } from './logger';

/**
 * Cache debugging utility
 * Helps diagnose cache issues and verify cache behavior
 */
export class CacheDebugger {
  /**
   * Test cache operations for a specific pubkey
   */
  static async testPubkeyCache(pubkey: string): Promise<void> {
    logger.info(`🔍 Cache Debug: Testing cache for pubkey: ${pubkey.substring(0, 8)}...`);

    // Test relay list cache
    logger.info('📡 Testing relay list cache...');
    const relays = await CacheService.getRelaysForPubkey(pubkey);
    if (relays) {
      logger.info(`  ✅ Relay list found: ${relays.length} relays`);
      logger.debug(`  Relays: ${relays.slice(0, 3).join(', ')}${relays.length > 3 ? '...' : ''}`);
    } else {
      logger.info(`  ❌ No relay list cached`);
    }

    // Test blossom servers cache
    logger.info('🌸 Testing blossom servers cache...');
    const servers = await CacheService.getBlossomServersForPubkey(pubkey);
    if (servers) {
      logger.info(`  ✅ Blossom servers found: ${servers.length} servers`);
      logger.debug(
        `  Servers: ${servers.slice(0, 3).join(', ')}${servers.length > 3 ? '...' : ''}`
      );
    } else {
      logger.info(`  ❌ No blossom servers cached`);
    }

    // Test common file paths
    const testPaths = ['/index.html', '/', '/about.html', '/404.html'];
    logger.info('📄 Testing file mapping cache...');

    for (const path of testPaths) {
      const mapping = await CacheService.getBlobForPath(pubkey, path);
      if (mapping) {
        logger.info(
          `  ✅ ${path} → ${mapping.sha256.substring(0, 8)}... (cached ${new Date(
            mapping.created_at * 1000
          ).toISOString()})`
        );
      } else {
        logger.info(`  ❌ ${path} not cached`);
      }
    }
  }

  /**
   * Test domain to pubkey mapping
   */
  static async testDomainCache(domain: string): Promise<void> {
    logger.info(`🌐 Cache Debug: Testing domain cache for: ${domain}`);

    const pubkey = await CacheService.getPubkeyForDomain(domain);
    if (pubkey) {
      logger.info(`  ✅ Domain mapped: ${domain} → ${pubkey.substring(0, 8)}...`);

      // Test related caches for this pubkey
      await this.testPubkeyCache(pubkey);
    } else {
      logger.info(`  ❌ Domain not cached: ${domain}`);
    }
  }

  /**
   * Test cache statistics and health
   */
  static async testCacheHealth(): Promise<void> {
    logger.info('🏥 Cache Health Check...');

    try {
      const stats = await CacheService.getStats();
      logger.info(`  Backend: ${stats.backend}`);
      logger.info(`  Initialized: ${stats.initialized}`);

      // Test basic cache operations
      const testKey = `debug-test-${Date.now()}`;
      const testValue = 'test-value';

      // Test domain cache
      await CacheService.setPubkeyForDomain(testKey, testValue);
      const retrieved = await CacheService.getPubkeyForDomain(testKey);

      if (retrieved === testValue) {
        logger.info('  ✅ Basic cache operations working');
      } else {
        logger.error('  ❌ Basic cache operations failing');
        logger.error(`    Expected: ${testValue}, Got: ${retrieved}`);
      }

      // Cleanup test data
      const caches = await CacheService['getCaches']();
      await caches.pubkeyDomains.delete(testKey);
    } catch (error) {
      logger.error('  ❌ Cache health check failed:', error);
    }
  }

  /**
   * Monitor cache activity in real-time
   */
  static startCacheMonitoring(): void {
    logger.info('🎯 Starting cache monitoring... (use Ctrl+C to stop)');
    logger.info('Set LOG_LEVEL=debug to see detailed cache hit/miss logs');

    // This relies on the debug logs we added to the cache methods
    logger.info('Monitor active - watch for cache HIT/MISS messages in logs');
    logger.info('Example patterns to look for:');
    logger.info('  🎯 = Cache HIT (good!)');
    logger.info('  💔 = Cache MISS (investigate if unexpected)');
    logger.info('  🚫 = Negative cache HIT (normal for missing content)');
  }

  /**
   * Force cache invalidation for debugging
   */
  static async invalidateDebugCache(pubkey: string): Promise<void> {
    logger.info(`🗑️  Force invalidating all cache for pubkey: ${pubkey.substring(0, 8)}...`);

    try {
      await CacheService.invalidateAllForPubkey(pubkey);
      logger.info('  ✅ Cache invalidation completed');
    } catch (error) {
      logger.error('  ❌ Cache invalidation failed:', error);
    }
  }

  /**
   * Set cache to debug-friendly TTL for testing
   */
  static async enableDebugMode(): Promise<void> {
    logger.info('🐛 Enabling cache debug mode...');
    logger.info('Recommendation: Set these environment variables:');
    logger.info('  LOG_LEVEL=debug');
    logger.info('  SLIDING_EXPIRATION=true');
    logger.info('  CACHE_TIME=3600 (1 hour)');
    logger.info('Then restart the server to see detailed cache logs');
  }
}
