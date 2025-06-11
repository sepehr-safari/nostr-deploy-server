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
        process.env.DEFAULT_RELAYS || 'wss://nos.lol,wss://ditto.pub/relay,wss://relay.damus.io'
      ),
      defaultBlossomServers: this.parseCommaSeparated(
        process.env.DEFAULT_BLOSSOM_SERVERS || 'https://cdn.hzrd149.com,https://nostr.download'
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
