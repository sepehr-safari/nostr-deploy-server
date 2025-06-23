import * as dotenv from 'dotenv';
import { ServerConfig } from '../types';

// Load environment variables
dotenv.config();

export class ConfigManager {
  private static instance: ConfigManager;
  private config: ServerConfig;

  private constructor() {
    this.config = {
      port: parseInt(process.env.PORT || '3000', 10),
      baseDomain: process.env.BASE_DOMAIN || '',
      defaultRelays: this.parseCommaSeparated(
        process.env.DEFAULT_RELAYS ||
          'wss://relay.nostr.band,wss://nostrue.com,wss://purplerelay.com,wss://relay.primal.net,wss://nos.lol,wss://relay.damus.io,wss://relay.nsite.lol'
      ),
      defaultBlossomServers: this.parseCommaSeparated(
        process.env.DEFAULT_BLOSSOM_SERVERS ||
          'https://cdn.hzrd149.com,https://blossom.primal.net,https://blossom.band,https://loratu.bitcointxoko.com,https://blossom.f7z.io,https://cdn.sovbit.host'
      ),
      cacheTtlSeconds: parseInt(process.env.CACHE_TTL_SECONDS || '300', 10),
      maxCacheSize: parseInt(process.env.MAX_CACHE_SIZE || '100', 10),
      rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
      rateLimitMaxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
      logLevel: process.env.LOG_LEVEL || 'info',
      corsOrigin: process.env.CORS_ORIGIN || '*',
      trustProxy: process.env.TRUST_PROXY === 'true',
      requestTimeoutMs: parseInt(process.env.REQUEST_TIMEOUT_MS || '30000', 10),
      maxFileSizeMB: parseInt(process.env.MAX_FILE_SIZE_MB || '50', 10),
      // SSR Configuration
      ssrEnabled: process.env.SSR_ENABLED === 'true', // Default is false
      ssrTimeoutMs: parseInt(process.env.SSR_TIMEOUT_MS || '60000', 10), // Increased to 60 seconds
      ssrCacheTtlSeconds: parseInt(process.env.SSR_CACHE_TTL_SECONDS || '1800', 10), // 30 minutes
      ssrViewportWidth: parseInt(process.env.SSR_VIEWPORT_WIDTH || '1920', 10),
      ssrViewportHeight: parseInt(process.env.SSR_VIEWPORT_HEIGHT || '1080', 10),
      ssrMaxConcurrentPages: parseInt(process.env.SSR_MAX_CONCURRENT_PAGES || '3', 10),
      // WebSocket Connection Pooling Configuration
      wsConnectionTimeoutMs: parseInt(process.env.WS_CONNECTION_TIMEOUT_MS || '3600000', 10), // 1 hour default
      wsCleanupIntervalMs: parseInt(process.env.WS_CLEANUP_INTERVAL_MS || '300000', 10), // 5 minutes default
      // Cache TTL Configuration
      negativeCacheTtlMs: parseInt(process.env.NEGATIVE_CACHE_TTL_MS || '10000', 10), // 10 seconds default
      positiveCacheTtlMs: parseInt(process.env.POSITIVE_CACHE_TTL_MS || '300000', 10), // 5 minutes default
      fileContentCacheTtlMs: parseInt(process.env.FILE_CONTENT_CACHE_TTL_MS || '1800000', 10), // 30 minutes default
      errorCacheTtlMs: parseInt(process.env.ERROR_CACHE_TTL_MS || '60000', 10), // 1 minute default
      // Query Timeout Configuration
      relayQueryTimeoutMs: parseInt(process.env.RELAY_QUERY_TIMEOUT_MS || '10000', 10), // 10 seconds default
    };

    this.validateConfig();
  }

  public static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }

  public getConfig(): ServerConfig {
    return { ...this.config };
  }

  public updateConfig(updates: Partial<ServerConfig>): void {
    this.config = { ...this.config, ...updates };
    this.validateConfig();
  }

  private parseCommaSeparated(value: string): string[] {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  private validateConfig(): void {
    const { config } = this;

    if (config.port < 1 || config.port > 65535) {
      throw new Error(`Invalid port: ${config.port}. Must be between 1-65535`);
    }

    if (!config.baseDomain) {
      throw new Error('BASE_DOMAIN is required');
    }

    if (config.defaultRelays.length === 0) {
      throw new Error('At least one default relay is required');
    }

    if (config.defaultBlossomServers.length === 0) {
      throw new Error('At least one default Blossom server is required');
    }

    // Validate relay URLs
    config.defaultRelays.forEach((relay) => {
      if (!relay.startsWith('wss://') && !relay.startsWith('ws://')) {
        throw new Error(`Invalid relay URL: ${relay}. Must start with ws:// or wss://`);
      }
    });

    // Validate Blossom server URLs
    config.defaultBlossomServers.forEach((server) => {
      if (!server.startsWith('https://') && !server.startsWith('http://')) {
        throw new Error(
          `Invalid Blossom server URL: ${server}. Must start with http:// or https://`
        );
      }
    });

    if (config.cacheTtlSeconds < 0) {
      throw new Error('Cache TTL cannot be negative');
    }

    if (config.maxCacheSize < 1) {
      throw new Error('Max cache size must be at least 1');
    }

    if (config.rateLimitWindowMs < 1000) {
      throw new Error('Rate limit window must be at least 1000ms');
    }

    if (config.rateLimitMaxRequests < 1) {
      throw new Error('Rate limit max requests must be at least 1');
    }

    if (config.requestTimeoutMs < 1000) {
      throw new Error('Request timeout must be at least 1000ms');
    }

    if (config.maxFileSizeMB < 1) {
      throw new Error('Max file size must be at least 1MB');
    }

    // SSR validation
    if (config.ssrTimeoutMs < 1000) {
      throw new Error('SSR timeout must be at least 1000ms');
    }

    if (config.ssrCacheTtlSeconds < 0) {
      throw new Error('SSR cache TTL cannot be negative');
    }

    if (config.ssrViewportWidth < 320 || config.ssrViewportWidth > 3840) {
      throw new Error('SSR viewport width must be between 320-3840 pixels');
    }

    if (config.ssrViewportHeight < 240 || config.ssrViewportHeight > 2160) {
      throw new Error('SSR viewport height must be between 240-2160 pixels');
    }

    if (config.ssrMaxConcurrentPages < 1 || config.ssrMaxConcurrentPages > 10) {
      throw new Error('SSR max concurrent pages must be between 1-10');
    }

    // WebSocket Connection Pooling Configuration
    if (config.wsConnectionTimeoutMs < 1000) {
      throw new Error('WS connection timeout must be at least 1000ms');
    }

    if (config.wsCleanupIntervalMs < 1000) {
      throw new Error('WS cleanup interval must be at least 1000ms');
    }

    // Cache TTL Configuration
    if (config.negativeCacheTtlMs < 0) {
      throw new Error('Negative cache TTL cannot be negative');
    }

    if (config.positiveCacheTtlMs < 1000) {
      throw new Error('Positive cache TTL must be at least 1000ms');
    }

    if (config.fileContentCacheTtlMs < 1000) {
      throw new Error('File content cache TTL must be at least 1000ms');
    }

    if (config.errorCacheTtlMs < 0) {
      throw new Error('Error cache TTL cannot be negative');
    }

    // Query Timeout Configuration
    if (config.relayQueryTimeoutMs < 1000) {
      throw new Error('Relay query timeout must be at least 1000ms');
    }
  }

  public isProduction(): boolean {
    return process.env.NODE_ENV === 'production';
  }

  public isDevelopment(): boolean {
    return process.env.NODE_ENV === 'development';
  }

  public isTest(): boolean {
    return process.env.NODE_ENV === 'test';
  }
}
