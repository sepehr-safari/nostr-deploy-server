// Type definitions for the Nostr Static Website Server

export interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

export interface ServerConfig {
  port: number;
  baseDomain: string;
  defaultRelays: string[];
  defaultBlossomServers: string[];
  cacheTtlSeconds: number;
  maxCacheSize: number;
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
  logLevel: string;
  corsOrigin: string;
  trustProxy: boolean;
  requestTimeoutMs: number;
  maxFileSizeMB: number;
  // SSR Configuration
  ssrEnabled: boolean;
  ssrTimeoutMs: number;
  ssrCacheTtlSeconds: number;
  ssrViewportWidth: number;
  ssrViewportHeight: number;
  ssrMaxConcurrentPages: number;
  // WebSocket Connection Pooling Configuration
  wsConnectionTimeoutMs: number;
  wsCleanupIntervalMs: number;
  // Cache TTL Configuration
  negativeCacheTtlMs: number;
  positiveCacheTtlMs: number;
  fileContentCacheTtlMs: number;
  errorCacheTtlMs: number;
  // Query Timeout Configuration
  relayQueryTimeoutMs: number;
  // Advanced Cache Configuration
  cachePath?: string;
  cacheTime: number;
  maxFileSize: number;

  // Real-time Cache Invalidation Configuration
  realtimeCacheInvalidation: boolean;
  invalidationRelays: string[];
  invalidationTimeoutMs: number;
  invalidationReconnectDelayMs: number;

  // Sliding Expiration Configuration
  slidingExpiration: boolean;
}

export interface StaticFileEvent extends NostrEvent {
  kind: 34128;
  tags: [string, string][];
}

export interface PathMapping {
  path: string;
  sha256: string;
  pubkey: string;
  eventId: string;
  createdAt: Date;
}

export interface RelayListEvent extends NostrEvent {
  kind: 10002;
  tags: [string, string, string][];
}

export interface BlossomServerListEvent extends NostrEvent {
  kind: 10063;
  tags: [string, string][];
}

export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

export interface FileResponse {
  content: Uint8Array;
  contentType: string;
  contentLength: number;
  sha256: string;
}

export interface BlossomServer {
  url: string;
  priority?: number;
}

export interface NostrRelay {
  url: string;
  read: boolean;
  write: boolean;
}

export interface PubkeyResolution {
  pubkey: string;
  npub?: string;
  subdomain: string;
  isValid: boolean;
}

export interface ParsedEvent {
  pubkey: string;
  path: string;
  sha256: string;
  created_at: number;
}
