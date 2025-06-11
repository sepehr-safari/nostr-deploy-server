import { CacheEntry } from '../types';
import { ConfigManager } from './config';
import { logger } from './logger';

export class MemoryCache<T> {
  private cache: Map<string, CacheEntry<T>>;
  private maxSize: number;
  private defaultTtl: number;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    const config = ConfigManager.getInstance().getConfig();
    this.cache = new Map();
    this.maxSize = config.maxCacheSize;
    this.defaultTtl = config.cacheTtlSeconds * 1000; // Convert to milliseconds

    // Start cleanup interval (every 60 seconds)
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60000);
  }

  public set(key: string, value: T, ttl?: number): void {
    // Remove expired entries if cache is full
    if (this.cache.size >= this.maxSize) {
      this.cleanup();

      // If still full, remove oldest entry
      if (this.cache.size >= this.maxSize) {
        const firstKey = this.cache.keys().next().value;
        if (firstKey) {
          this.cache.delete(firstKey);
          logger.debug(`Cache evicted oldest entry: ${firstKey}`);
        }
      }
    }

    const entry: CacheEntry<T> = {
      data: value,
      timestamp: Date.now(),
      ttl: ttl !== undefined ? ttl : this.defaultTtl,
    };

    this.cache.set(key, entry);
    logger.debug(`Cache set: ${key} (TTL: ${entry.ttl}ms)`);
  }

  public get(key: string): T | null {
    const entry = this.cache.get(key);

    if (!entry) {
      logger.debug(`Cache miss: ${key}`);
      return null;
    }

    // Check if entry has expired
    if (this.isExpired(entry)) {
      this.cache.delete(key);
      logger.debug(`Cache expired: ${key}`);
      return null;
    }

    logger.debug(`Cache hit: ${key}`);
    return entry.data;
  }

  public has(key: string): boolean {
    const entry = this.cache.get(key);

    if (!entry) {
      return false;
    }

    if (this.isExpired(entry)) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  public delete(key: string): boolean {
    const deleted = this.cache.delete(key);
    if (deleted) {
      logger.debug(`Cache deleted: ${key}`);
    }
    return deleted;
  }

  public clear(): void {
    const size = this.cache.size;
    this.cache.clear();
    logger.info(`Cache cleared (${size} entries)`);
  }

  public size(): number {
    return this.cache.size;
  }

  public keys(): string[] {
    return Array.from(this.cache.keys());
  }

  private isExpired(entry: CacheEntry<T>): boolean {
    return Date.now() - entry.timestamp > entry.ttl;
  }

  private cleanup(): void {
    let cleanedCount = 0;
    const now = Date.now();

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        this.cache.delete(key);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      logger.debug(`Cache cleanup: removed ${cleanedCount} expired entries`);
    }
  }

  public getStats(): {
    size: number;
    maxSize: number;
    hitRate: number;
    expiredCount: number;
  } {
    let expiredCount = 0;
    const now = Date.now();

    for (const [, entry] of this.cache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        expiredCount++;
      }
    }

    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hitRate: 0, // TODO: Implement hit rate tracking
      expiredCount,
    };
  }

  public destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.clear();
  }
}

// Create singleton instances for different cache types
export const pathMappingCache = new MemoryCache<string>();
export const relayListCache = new MemoryCache<string[]>();
export const blossomServerCache = new MemoryCache<string[]>();
export const fileContentCache = new MemoryCache<Uint8Array>();
