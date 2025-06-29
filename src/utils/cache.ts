import Keyv from 'keyv';
import { ParsedEvent } from '../types';
import { ConfigManager } from './config';
import { logger } from './logger';

const log = logger;

interface KeyvOptions {
  store?: any;
  namespace?: string;
  ttl?: number;
  serialize?: (data: any) => string;
  deserialize?: (data: string) => any;
}

class AdvancedCacheManager {
  private config = ConfigManager.getInstance().getConfig();
  private store: any = null;
  private initialized = false;

  async initialize() {
    if (this.initialized) return;

    this.store = await this.createStore();
    this.initialized = true;

    if (this.store) {
      this.store.on('error', (err: Error) => {
        log.error('Cache Connection Error', err);
        process.exit(1);
      });
    }
  }

  private async createStore() {
    const cachePath = this.config.cachePath;

    if (!cachePath || cachePath === 'in-memory') {
      log.info('Using in-memory cache');
      return undefined;
    } else if (cachePath.startsWith('redis://')) {
      try {
        // @ts-ignore - @keyv/redis doesn't have TypeScript declarations
        const { default: KeyvRedis } = await import('@keyv/redis');
        log.info(`Using redis cache at ${cachePath}`);
        return new KeyvRedis(cachePath);
      } catch (error) {
        log.error('Failed to initialize Redis cache, falling back to in-memory', error);
        return undefined;
      }
    } else if (cachePath.startsWith('sqlite://')) {
      try {
        // @ts-ignore - @keyv/sqlite doesn't have TypeScript declarations
        const { default: KeyvSqlite } = await import('@keyv/sqlite');
        log.info(`Using sqlite cache at ${cachePath}`);
        return new KeyvSqlite(cachePath);
      } catch (error) {
        log.error('Failed to initialize SQLite cache, falling back to in-memory', error);
        return undefined;
      }
    }

    log.warn(`Unknown cache path format: ${cachePath}, using in-memory cache`);
    return undefined;
  }

  private getKeyvOptions(): KeyvOptions {
    const json: KeyvOptions = {
      serialize: (data: any) => {
        // Handle Uint8Array serialization
        if (data instanceof Uint8Array) {
          return JSON.stringify({ __type: 'Uint8Array', data: Array.from(data) });
        }
        // Handle nested objects that might contain Uint8Array
        if (typeof data === 'object' && data !== null) {
          const serialized = this.serializeWithUint8Array(data);
          return JSON.stringify(serialized);
        }
        return JSON.stringify(data);
      },
      deserialize: (data: string) => {
        try {
          const parsed = JSON.parse(data);
          // Handle direct Uint8Array deserialization
          if (parsed && parsed.__type === 'Uint8Array' && Array.isArray(parsed.data)) {
            return new Uint8Array(parsed.data);
          }
          // Handle nested objects that might contain Uint8Array
          if (typeof parsed === 'object' && parsed !== null) {
            return this.deserializeWithUint8Array(parsed);
          }
          return parsed;
        } catch (error) {
          // Fallback for malformed data
          return null;
        }
      },
    };
    const opts: KeyvOptions = this.store ? { store: this.store } : {};
    return { ...opts, ...json };
  }

  // Helper method to serialize nested objects with Uint8Array
  private serializeWithUint8Array(obj: any): any {
    if (obj instanceof Uint8Array) {
      return { __type: 'Uint8Array', data: Array.from(obj) };
    }
    if (Array.isArray(obj)) {
      return obj.map((item) => this.serializeWithUint8Array(item));
    }
    if (typeof obj === 'object' && obj !== null) {
      const result: any = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this.serializeWithUint8Array(value);
      }
      return result;
    }
    return obj;
  }

  // Helper method to deserialize nested objects with Uint8Array
  private deserializeWithUint8Array(obj: any): any {
    if (obj && obj.__type === 'Uint8Array' && Array.isArray(obj.data)) {
      return new Uint8Array(obj.data);
    }
    if (Array.isArray(obj)) {
      return obj.map((item) => this.deserializeWithUint8Array(item));
    }
    if (typeof obj === 'object' && obj !== null) {
      const result: any = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this.deserializeWithUint8Array(value);
      }
      return result;
    }
    return obj;
  }

  private createCache<T>(namespace: string, ttl?: number): Keyv<T | undefined> {
    return new Keyv<T | undefined>({
      ...this.getKeyvOptions(),
      namespace,
      ttl: (ttl || this.config.cacheTime) * 1000,
    });
  }

  // Initialize all cache instances
  async getCaches() {
    await this.initialize();

    return {
      /** A cache that maps a domain to a pubkey ( domain -> pubkey ) */
      pubkeyDomains: this.createCache<string>('domains'),

      /** A cache that maps a pubkey to a set of blossom servers ( pubkey -> servers ) */
      pubkeyServers: this.createCache<string[]>('servers'),

      /** A cache that maps a pubkey to a set of relays ( pubkey -> relays ) */
      pubkeyRelays: this.createCache<string[]>('relays'),

      /** A cache that maps a pubkey + path to sha256 hash of the blob ( pubkey/path -> sha256 ) */
      pathBlobs: this.createCache<ParsedEvent>('paths'),

      /** A cache that maps a sha256 hash to a set of URLs that had the blob ( sha256 -> URLs ) */
      blobURLs: this.createCache<string[]>('blobs'),

      /** A cache for file content */
      fileContent: this.createCache<Uint8Array>(
        'content',
        this.config.fileContentCacheTtlMs / 1000
      ),

      /** A cache for negative results (not found) */
      negativeCache: this.createCache<boolean>('negative', this.config.negativeCacheTtlMs / 1000),
    };
  }
}

// Create singleton instance
const cacheManager = new AdvancedCacheManager();

// Export the cache instances
export const getCacheInstances = () => cacheManager.getCaches();

// Utility functions for common cache operations
export class CacheService {
  private static caches: any = null;

  private static async getCaches() {
    if (!this.caches) {
      this.caches = await getCacheInstances();
    }
    return this.caches;
  }

  // ==========================================
  // Core Cache Operations with Sliding Expiration
  // ==========================================

  /**
   * Get value from cache and optionally refresh TTL (sliding expiration)
   */
  private static async getWithSlidingExpiration<T>(
    cache: any,
    key: string,
    refreshTtl: boolean = true,
    customTtlSeconds?: number
  ): Promise<T | null> {
    const value = await cache.get(key);

    if (value && refreshTtl) {
      // Refresh TTL by setting the same value with new expiration
      const config = ConfigManager.getInstance().getConfig();
      const ttlMs = customTtlSeconds ? customTtlSeconds * 1000 : config.cacheTime * 1000;

      // Set the value again with refreshed TTL
      await cache.set(key, value, ttlMs);

      log.debug(
        `🔄 TTL refreshed for cache key: ${key.substring(0, 32)}${key.length > 32 ? '...' : ''}`
      );
    }

    return value || null;
  }

  /**
   * Touch multiple cache entries to refresh their TTL
   * Used when accessing a domain triggers refresh of all related cache entries
   */
  private static async touchRelatedCacheEntries(pubkey: string, domain?: string): Promise<void> {
    const config = ConfigManager.getInstance().getConfig();

    // Only perform if sliding expiration is enabled
    if (!config.slidingExpiration) {
      return;
    }

    const caches = await this.getCaches();
    const operations: Promise<void>[] = [];

    try {
      // Refresh domain mapping if provided
      if (domain) {
        const domainValue = await caches.pubkeyDomains.get(domain);
        if (domainValue) {
          operations.push(caches.pubkeyDomains.set(domain, domainValue, config.cacheTime * 1000));
        }
      }

      // Refresh pubkey-related caches
      const [servers, relays] = await Promise.all([
        caches.pubkeyServers.get(pubkey),
        caches.pubkeyRelays.get(pubkey),
      ]);

      if (servers) {
        operations.push(caches.pubkeyServers.set(pubkey, servers, config.cacheTime * 1000));
      }

      if (relays) {
        operations.push(caches.pubkeyRelays.set(pubkey, relays, config.cacheTime * 1000));
      }

      // Execute all operations in parallel
      await Promise.all(operations);

      log.debug(
        `🔄 TTL refreshed for ${
          operations.length
        } related cache entries for pubkey: ${pubkey.substring(0, 8)}...`
      );
    } catch (error) {
      log.warn('Failed to refresh related cache entries:', error);
    }
  }

  // ==========================================
  // Domain Resolution Cache Operations
  // ==========================================

  // Domain resolution cache operations
  static async getPubkeyForDomain(domain: string): Promise<string | null> {
    const caches = await this.getCaches();
    const config = ConfigManager.getInstance().getConfig();
    const result = await this.getWithSlidingExpiration(
      caches.pubkeyDomains,
      domain,
      config.slidingExpiration
    );

    if (result) {
      log.debug(`🎯 Domain cache HIT: ${domain} → ${(result as string).substring(0, 8)}...`);
    } else {
      log.debug(`💔 Domain cache MISS: ${domain}`);
    }

    return result as string | null;
  }

  static async setPubkeyForDomain(domain: string, pubkey: string): Promise<void> {
    const caches = await this.getCaches();
    await caches.pubkeyDomains.set(domain, pubkey);
  }

  // ==========================================
  // Blossom Servers Cache Operations
  // ==========================================

  // Blossom servers cache operations
  static async getBlossomServersForPubkey(pubkey: string): Promise<string[] | null> {
    const caches = await this.getCaches();
    const config = ConfigManager.getInstance().getConfig();
    const result = await this.getWithSlidingExpiration(
      caches.pubkeyServers,
      pubkey,
      config.slidingExpiration
    );

    if (result) {
      log.debug(
        `🎯 Blossom servers cache HIT for ${pubkey.substring(0, 8)}... (${
          (result as string[]).length
        } servers)`
      );
    } else {
      log.debug(`💔 Blossom servers cache MISS for ${pubkey.substring(0, 8)}...`);
    }

    return result as string[] | null;
  }

  static async setBlossomServersForPubkey(pubkey: string, servers: string[]): Promise<void> {
    const caches = await this.getCaches();
    await caches.pubkeyServers.set(pubkey, servers);
  }

  // ==========================================
  // Relay Cache Operations
  // ==========================================

  // Relay cache operations
  static async getRelaysForPubkey(pubkey: string): Promise<string[] | null> {
    const caches = await this.getCaches();
    const config = ConfigManager.getInstance().getConfig();
    const result = await this.getWithSlidingExpiration(
      caches.pubkeyRelays,
      pubkey,
      config.slidingExpiration
    );

    if (result) {
      log.debug(
        `🎯 Relay list cache HIT for ${pubkey.substring(0, 8)}... (${
          (result as string[]).length
        } relays)`
      );
    } else {
      log.debug(`💔 Relay list cache MISS for ${pubkey.substring(0, 8)}...`);
    }

    return result as string[] | null;
  }

  static async setRelaysForPubkey(pubkey: string, relays: string[]): Promise<void> {
    const caches = await this.getCaches();
    await caches.pubkeyRelays.set(pubkey, relays);
  }

  // ==========================================
  // Path to Blob Mapping Cache Operations
  // ==========================================

  // Path to blob mapping cache operations
  static async getBlobForPath(pubkey: string, path: string): Promise<ParsedEvent | null> {
    const caches = await this.getCaches();
    const config = ConfigManager.getInstance().getConfig();
    const key = pubkey + path;
    const result = await this.getWithSlidingExpiration(
      caches.pathBlobs,
      key,
      config.slidingExpiration
    );

    if (result) {
      log.debug(
        `🎯 Path mapping cache HIT: ${path} for ${pubkey.substring(0, 8)}... → ${(
          result as ParsedEvent
        ).sha256.substring(0, 8)}...`
      );
    } else {
      log.debug(`💔 Path mapping cache MISS: ${path} for ${pubkey.substring(0, 8)}...`);
    }

    return result as ParsedEvent | null;
  }

  static async setBlobForPath(pubkey: string, path: string, event: ParsedEvent): Promise<void> {
    const caches = await this.getCaches();
    const key = pubkey + path;
    await caches.pathBlobs.set(key, event);
  }

  static async invalidateBlobForPath(pubkey: string, path: string): Promise<void> {
    const caches = await this.getCaches();
    const key = pubkey + path;
    await caches.pathBlobs.delete(key);
  }

  // ==========================================
  // Blob URLs Cache Operations
  // ==========================================

  // Blob URLs cache operations
  static async getBlobURLs(sha256: string): Promise<string[] | null> {
    const caches = await this.getCaches();
    const config = ConfigManager.getInstance().getConfig();
    const result = await this.getWithSlidingExpiration(
      caches.blobURLs,
      sha256,
      config.slidingExpiration
    );

    if (result) {
      log.debug(
        `🎯 Blob URLs cache HIT for ${sha256.substring(0, 8)}... (${
          (result as string[]).length
        } URLs)`
      );
    } else {
      log.debug(`💔 Blob URLs cache MISS for ${sha256.substring(0, 8)}...`);
    }

    return result as string[] | null;
  }

  static async setBlobURLs(sha256: string, urls: string[]): Promise<void> {
    const caches = await this.getCaches();
    await caches.blobURLs.set(sha256, urls);
  }

  // ==========================================
  // File Content Cache Operations
  // ==========================================

  // File content cache operations
  static async getFileContent(sha256: string): Promise<Uint8Array | null> {
    const caches = await this.getCaches();
    const config = ConfigManager.getInstance().getConfig();

    // Use custom TTL for file content cache
    const customTtlSeconds = config.fileContentCacheTtlMs / 1000;
    const cached = await this.getWithSlidingExpiration(
      caches.fileContent,
      sha256,
      config.slidingExpiration,
      customTtlSeconds
    );

    // Ensure we always return a Uint8Array or null
    if (!cached) return null;

    // If the cached data is not a Uint8Array (deserialization issue), try to convert it
    if (!(cached instanceof Uint8Array)) {
      console.warn(`Cached file content for ${sha256} is not a Uint8Array, attempting conversion`);

      // Handle case where it might be a plain object with numeric indices
      if (typeof cached === 'object' && cached !== null) {
        try {
          // Try to convert object to array and then to Uint8Array
          const values = Object.values(cached as any);
          if (values.every((v) => typeof v === 'number' && v >= 0 && v <= 255)) {
            return new Uint8Array(values as number[]);
          }
        } catch (error) {
          console.error(`Failed to convert cached content for ${sha256}:`, error);
        }
      }

      // If conversion fails, return null to force re-fetch
      return null;
    }

    return cached;
  }

  static async setFileContent(sha256: string, content: Uint8Array): Promise<void> {
    if (!(content instanceof Uint8Array)) {
      throw new Error(`setFileContent requires Uint8Array, got ${typeof content}`);
    }
    const caches = await this.getCaches();
    await caches.fileContent.set(sha256, content);
  }

  // Negative cache operations (for "not found" results)
  static async isNegativeCached(key: string): Promise<boolean> {
    const caches = await this.getCaches();
    return (await caches.negativeCache.get(key)) || false;
  }

  static async setNegativeCache(key: string): Promise<void> {
    const caches = await this.getCaches();
    await caches.negativeCache.set(key, true);
  }

  // Clear all caches
  static async clearAll(): Promise<void> {
    const caches = await this.getCaches();
    await Promise.all([
      caches.pubkeyDomains.clear(),
      caches.pubkeyServers.clear(),
      caches.pubkeyRelays.clear(),
      caches.pathBlobs.clear(),
      caches.blobURLs.clear(),
      caches.fileContent.clear(),
      caches.negativeCache.clear(),
    ]);
    log.info('All caches cleared');
  }

  // Get cache statistics (basic implementation)
  static async getStats(): Promise<Record<string, any>> {
    const caches = await this.getCaches();

    // Basic stats - actual implementation would depend on cache store
    return {
      backend: cacheManager['config'].cachePath || 'in-memory',
      initialized: cacheManager['initialized'],
      // Individual cache stats would require store-specific implementation
    };
  }

  // ==========================================
  // Real-time Cache Invalidation Methods
  // ==========================================

  /**
   * Invalidate relay list cache for a specific pubkey
   * Used by real-time cache invalidation when relay list events are received
   */
  static async invalidateRelaysForPubkey(pubkey: string): Promise<void> {
    const caches = await this.getCaches();
    await caches.pubkeyRelays.delete(pubkey);
    log.info(`Invalidated relay list cache for: ${pubkey.substring(0, 8)}...`);
  }

  /**
   * Invalidate blossom server list cache for a specific pubkey
   * Used by real-time cache invalidation when blossom server events are received
   */
  static async invalidateBlossomServersForPubkey(pubkey: string): Promise<void> {
    const caches = await this.getCaches();
    await caches.pubkeyServers.delete(pubkey);
    log.info(`Invalidated blossom server cache for: ${pubkey.substring(0, 8)}...`);
  }

  /**
   * Invalidate all cache entries for a specific pubkey
   * Nuclear option for when we want to clear everything related to a user
   */
  static async invalidateAllForPubkey(pubkey: string): Promise<void> {
    const caches = await this.getCaches();

    await Promise.all([
      // Relay lists
      caches.pubkeyRelays.delete(pubkey),
      // Blossom servers
      caches.pubkeyServers.delete(pubkey),
      // Note: Path mappings and domain resolution would require scanning keys
    ]);

    log.info(`Invalidated major cache entries for: ${pubkey.substring(0, 8)}...`);
  }

  /**
   * Invalidate negative cache entries
   * Useful when we know data has been published that was previously missing
   */
  static async invalidateNegativeCache(pattern?: string): Promise<void> {
    const caches = await this.getCaches();

    if (pattern) {
      await caches.negativeCache.delete(pattern);
      log.debug(`Invalidated negative cache for pattern: ${pattern}`);
    } else {
      // Clear all negative cache entries
      await caches.negativeCache.clear();
      log.info('Cleared all negative cache entries');
    }
  }

  // ==========================================
  // High-Level Domain Access Method
  // ==========================================

  /**
   * Main method for handling domain access with sliding expiration
   * This method should be called when a user accesses a domain
   * It refreshes TTL for all related cache entries
   */
  static async handleDomainAccess(domain: string, pubkey: string): Promise<void> {
    const config = ConfigManager.getInstance().getConfig();

    if (!config.slidingExpiration) {
      return;
    }

    log.info(
      `🔄 Refreshing cache TTL for domain access: ${domain} (pubkey: ${pubkey.substring(0, 8)}...)`
    );

    try {
      await this.touchRelatedCacheEntries(pubkey, domain);
      log.debug(`✅ Cache TTL refresh completed for domain: ${domain}`);
    } catch (error) {
      log.warn(`⚠️  Failed to refresh cache TTL for domain: ${domain}`, error);
    }
  }
}

// Legacy exports for backward compatibility
export class MemoryCache<T> {
  private cache: Map<string, { data: T; timestamp: number; ttl: number }>;
  private maxSize: number;
  private defaultTtl: number;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    const config = ConfigManager.getInstance().getConfig();
    this.cache = new Map();
    this.maxSize = config.maxCacheSize;
    this.defaultTtl = config.cacheTtlSeconds * 1000;

    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60000);
  }

  public set(key: string, value: T, ttl?: number): void {
    if (this.cache.size >= this.maxSize) {
      this.cleanup();
      if (this.cache.size >= this.maxSize) {
        const firstKey = this.cache.keys().next().value;
        if (firstKey) {
          this.cache.delete(firstKey);
        }
      }
    }

    const entry = {
      data: value,
      timestamp: Date.now(),
      ttl: ttl !== undefined ? ttl : this.defaultTtl,
    };

    this.cache.set(key, entry);
  }

  public get(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (this.isExpired(entry)) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  public has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

    if (this.isExpired(entry)) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  public delete(key: string): boolean {
    return this.cache.delete(key);
  }

  public clear(): void {
    this.cache.clear();
  }

  public size(): number {
    return this.cache.size;
  }

  public keys(): string[] {
    return Array.from(this.cache.keys());
  }

  private isExpired(entry: { timestamp: number; ttl: number }): boolean {
    return Date.now() - entry.timestamp > entry.ttl;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        this.cache.delete(key);
      }
    }
  }

  public destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.clear();
  }
}

// Legacy exports - these will be replaced by the new cache system
export const pathMappingCache = new MemoryCache<string>();
export const relayListCache = new MemoryCache<string[]>();
export const blossomServerCache = new MemoryCache<string[]>();
export const fileContentCache = new MemoryCache<Uint8Array>();
