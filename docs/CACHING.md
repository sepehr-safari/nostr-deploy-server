# Advanced Caching System Documentation

## Overview

The **Advanced Caching System** is a sophisticated multi-layer caching implementation inspired by modern NoSQL/distributed caching patterns. It provides significant performance improvements for the nostr-deploy-server through intelligent caching strategies.

## Architecture

### Multi-Backend Support

The system supports three cache backends that can be switched via configuration:

1. **In-Memory Cache** (Default)

   - Zero configuration
   - Fastest performance
   - Data lost on restart
   - Best for: Development, testing

2. **Redis Cache** (Recommended for production)

   - Persistent storage
   - Horizontal scaling
   - Network-based
   - Best for: Production, multi-instance deployments

3. **SQLite Cache**
   - Persistent storage
   - File-based
   - Single instance
   - Best for: Small to medium deployments

### Cache Layers

The system implements multiple specialized cache layers:

| Cache Layer           | Purpose                                     | Key Format                    | TTL        |
| --------------------- | ------------------------------------------- | ----------------------------- | ---------- |
| **Domain Resolution** | Maps domain names to pubkeys                | `domain` → `pubkey`           | 1 hour     |
| **Blossom Servers**   | Caches available blossom servers per pubkey | `pubkey` → `servers[]`        | 1 hour     |
| **Relay Lists**       | Caches relay lists per pubkey               | `pubkey` → `relays[]`         | 1 hour     |
| **Path Mapping**      | Maps file paths to blob metadata            | `pubkey/path` → `ParsedEvent` | 1 hour     |
| **Blob URLs**         | Caches available URLs for each blob         | `sha256` → `urls[]`           | 1 hour     |
| **File Content**      | Caches actual file content                  | `sha256` → `Uint8Array`       | 30 minutes |
| **Negative Cache**    | Caches "not found" results                  | `key` → `boolean`             | 10 seconds |

### Sliding Expiration

The **Sliding Expiration** feature automatically refreshes cache TTL when entries are accessed, keeping frequently used sites in cache longer while allowing unused sites to expire naturally.

#### How It Works

1. **On Domain Access**: When a user visits `npubxyz.example.com`, all related cache entries get their TTL refreshed
2. **Related Entries**: Domain mapping, relay lists, blossom servers, and path mappings for that pubkey
3. **TTL Refresh**: Each accessed cache entry gets its full TTL duration renewed
4. **Automatic**: No manual intervention needed - happens transparently during normal operations

#### Benefits

- **Better Performance**: Frequently accessed sites stay cached longer
- **Efficient Resource Usage**: Unused sites expire naturally, freeing up cache space
- **Improved User Experience**: Popular sites have consistently fast load times
- **Cost Effective**: Reduces redundant Nostr relay queries for active sites

#### Configuration

Enable sliding expiration via environment variable:

```bash
# Enable sliding expiration (default: false)
SLIDING_EXPIRATION=true
```

#### Example Behavior

**Without Sliding Expiration:**

- Site cached at 10:00 AM with 1-hour TTL
- Site expires at 11:00 AM regardless of access frequency
- Next access at 10:50 AM still requires re-fetch at 11:00 AM

**With Sliding Expiration:**

- Site cached at 10:00 AM with 1-hour TTL
- User accesses site at 10:30 AM → TTL refreshed to 11:30 AM
- User accesses site at 11:15 AM → TTL refreshed to 12:15 PM
- Site stays cached as long as it's accessed within the TTL window

#### Performance Impact

- **Minimal Overhead**: Only adds a few milliseconds per request
- **Network Efficient**: Reduces outbound Nostr relay queries
- **Cache Efficient**: Smart refresh only updates related entries
- **Configurable**: Can be disabled if not needed

## Configuration

### Environment Variables

```bash
# Cache Backend Selection
CACHE_PATH=in-memory                    # Default - no persistence
CACHE_PATH=redis://localhost:6379       # Redis with default settings
CACHE_PATH=redis://:password@host:6379   # Redis with password
CACHE_PATH=sqlite:///path/to/cache.db    # SQLite file-based

# Cache Timing
CACHE_TIME=3600                         # Default TTL in seconds (1 hour)
```

### Redis Setup Examples

**Basic Redis:**

```bash
# Install and start Redis
brew install redis && brew services start redis

# Configure environment
echo "CACHE_PATH=redis://localhost:6379" >> .env
```

**Redis with Authentication:**

```bash
# Redis with password
echo "CACHE_PATH=redis://:mypassword@localhost:6379" >> .env

# Redis with username and password (Redis 6+)
echo "CACHE_PATH=redis://user:pass@localhost:6379" >> .env
```

**Redis in Docker:**

```bash
# Start Redis container
docker run -d --name redis-cache -p 6379:6379 redis:alpine

# With persistent volume
docker run -d --name redis-cache \
  -p 6379:6379 \
  -v redis-data:/data \
  redis:alpine redis-server --appendonly yes
```

### SQLite Setup Examples

**Basic SQLite:**

```bash
# Create cache directory
mkdir -p ./data

# Configure environment
echo "CACHE_PATH=sqlite://./data/cache.db" >> .env
```

**Production SQLite:**

```bash
# System-wide cache directory
sudo mkdir -p /var/lib/nostr-deploy
sudo chown $(whoami):$(whoami) /var/lib/nostr-deploy

# Configure environment
echo "CACHE_PATH=sqlite:///var/lib/nostr-deploy/cache.db" >> .env
```

## API Reference

### CacheService Class

The `CacheService` provides a high-level API for all cache operations:

#### Domain Resolution

```typescript
// Cache domain to pubkey mapping
await CacheService.setPubkeyForDomain(domain: string, pubkey: string): Promise<void>

// Retrieve pubkey for domain
await CacheService.getPubkeyForDomain(domain: string): Promise<string | null>
```

#### Blossom Servers

```typescript
// Cache blossom servers for pubkey
await CacheService.setBlossomServersForPubkey(pubkey: string, servers: string[]): Promise<void>

// Retrieve blossom servers for pubkey
await CacheService.getBlossomServersForPubkey(pubkey: string): Promise<string[] | null>
```

#### Relay Lists

```typescript
// Cache relays for pubkey
await CacheService.setRelaysForPubkey(pubkey: string, relays: string[]): Promise<void>

// Retrieve relays for pubkey
await CacheService.getRelaysForPubkey(pubkey: string): Promise<string[] | null>
```

#### Path to Blob Mapping

```typescript
// Cache blob event for path
await CacheService.setBlobForPath(pubkey: string, path: string, event: ParsedEvent): Promise<void>

// Retrieve blob event for path
await CacheService.getBlobForPath(pubkey: string, path: string): Promise<ParsedEvent | null>

// Invalidate cached blob for path
await CacheService.invalidateBlobForPath(pubkey: string, path: string): Promise<void>
```

#### Blob URLs

```typescript
// Cache available URLs for blob
await CacheService.setBlobURLs(sha256: string, urls: string[]): Promise<void>

// Retrieve available URLs for blob
await CacheService.getBlobURLs(sha256: string): Promise<string[] | null>
```

#### File Content

```typescript
// Cache file content
await CacheService.setFileContent(sha256: string, content: Uint8Array): Promise<void>

// Retrieve file content
await CacheService.getFileContent(sha256: string): Promise<Uint8Array | null>
```
