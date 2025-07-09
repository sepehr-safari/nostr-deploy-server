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

## Real-Time Cache Invalidation System

The **Real-Time Cache Invalidation System** is a sophisticated pre-caching mechanism that monitors Nostr relays for content updates and immediately updates cache entries, ensuring users always receive the latest content without waiting for cache expiration.

### Architecture Overview

The system consists of the `CacheInvalidationService` class that maintains persistent connections to configured Nostr relays and processes relevant events in real-time:

```
┌─────────────────┐    ┌──────────────────────┐    ┌───────────────────┐
│   Nostr Relay   │───▶│  CacheInvalidation   │───▶│   Cache Storage   │
│  (Kind 34128)   │    │      Service         │    │  (Redis/SQLite)   │
└─────────────────┘    └──────────────────────┘    └───────────────────┘
                                  │
                                  ▼
                       ┌──────────────────────┐
                       │    User Request      │
                       │  (Zero Latency)      │
                       └──────────────────────┘
```

### Event Processing

#### Static File Events (Kind 34128)

When a user publishes a static file mapping to Nostr:

```json
{
  "kind": 34128,
  "pubkey": "user_pubkey",
  "tags": [
    ["d", "/index.html"],
    ["x", "186ea5fd14e88fd1ac49351759e7ab906fa94892002b60bf7f5a428f28ca1c99"]
  ],
  "created_at": 1699123456
}
```

The system immediately:

1. **Extracts** the path (`/index.html`) and SHA256 hash
2. **Creates** a `ParsedEvent` with the mapping data
3. **Updates** the cache with `CacheService.setBlobForPath(pubkey, path, parsedEvent)`
4. **Logs** the cache update for monitoring

#### Relay List Events (Kind 10002)

When users update their preferred relay lists:

```json
{
  "kind": 10002,
  "pubkey": "user_pubkey",
  "tags": [
    ["r", "wss://relay.example.com"],
    ["r", "wss://relay2.example.com", "read"]
  ]
}
```

The system:

1. **Parses** relay URLs and types (read/write)
2. **Filters** for read-capable relays
3. **Updates** the cache with `CacheService.setRelaysForPubkey(pubkey, relays)`

#### Blossom Server Events (Kind 10063)

When users update their preferred Blossom servers:

```json
{
  "kind": 10063,
  "pubkey": "user_pubkey",
  "tags": [
    ["server", "https://blossom.example.com"],
    ["server", "https://cdn.example.com"]
  ]
}
```

The system:

1. **Extracts** server URLs from tags
2. **Updates** the cache with `CacheService.setBlossomServersForPubkey(pubkey, servers)`

### Configuration

#### Basic Configuration

```bash
# Enable/disable real-time cache invalidation
REALTIME_CACHE_INVALIDATION=true

# Relays to monitor for cache invalidation events
INVALIDATION_RELAYS=wss://relay.primal.net,wss://relay.damus.io,wss://relay.nostr.band

# Connection timeouts
INVALIDATION_TIMEOUT_MS=30000
INVALIDATION_RECONNECT_DELAY_MS=5000
```

#### Recommended Relay Selection

Choose **fast, reliable relays** for invalidation monitoring:

**Primary Relays (Recommended):**

- `wss://relay.primal.net` - High performance, reliable
- `wss://relay.damus.io` - Well-maintained, fast
- `wss://relay.nostr.band` - Comprehensive coverage

**Additional Options:**

- `wss://nos.lol` - Good for specific communities
- `wss://relay.nsite.lol` - Alternative reliable option

#### Production Configuration

For production deployments, consider:

```bash
# Use multiple reliable relays
INVALIDATION_RELAYS=wss://relay.primal.net,wss://relay.damus.io,wss://relay.nostr.band,wss://nos.lol

# Shorter timeout for faster responses
INVALIDATION_TIMEOUT_MS=15000

# Faster reconnection for high availability
INVALIDATION_RECONNECT_DELAY_MS=3000
```

### Performance Characteristics

#### Latency Benefits

- **Traditional Caching**: User request → Query Nostr → Cache → Response (~500-2000ms)
- **Pre-Caching**: User request → Cache hit → Response (~5-50ms)

#### Resource Usage

- **Memory**: Minimal additional overhead (~1-5MB per 1000 cached mappings)
- **Network**: Persistent WebSocket connections to configured relays
- **CPU**: Low impact event processing (~0.1% CPU per 100 events/minute)

#### Scalability

- **Horizontal**: Multiple server instances can share the same cache backend
- **Vertical**: Handles thousands of events per minute on modest hardware
- **Fault Tolerance**: Automatic reconnection and error recovery

### Monitoring and Debugging

#### Service Statistics

Get real-time statistics about the invalidation service:

```typescript
import { CacheInvalidationService } from './helpers/cache-invalidation';

const service = new CacheInvalidationService();
const stats = service.getStats();

console.log({
  enabled: stats.enabled,
  connectedRelays: stats.connectedRelays,
  activeSubscriptions: stats.activeSubscriptions,
  relays: stats.relays,
});
```

#### Logging

The system provides comprehensive logging for monitoring:

```bash
# Enable debug logging
LOG_LEVEL=debug

# Example log output
[INFO] Real-time cache invalidation service enabled
[INFO] Cache invalidation service initialized with 3 relays
[INFO] 📥 Received static file event (kind 34128) from abcd1234... (5s ago)
[INFO] ✅ Cache UPDATED for static file: /index.html by abcd1234... → 186ea5fd...
```

#### Common Issues and Solutions

**Issue**: No events being received

```bash
# Check relay connectivity
curl -I https://relay.primal.net/.well-known/nostr.json

# Verify configuration
echo $INVALIDATION_RELAYS
```

**Issue**: High memory usage

```bash
# Monitor cache size
redis-cli info memory  # For Redis backend

# Consider shorter TTL
CACHE_TIME=1800  # 30 minutes instead of 1 hour
```

**Issue**: Slow reconnection

```bash
# Reduce reconnection delay
INVALIDATION_RECONNECT_DELAY_MS=2000
```

### Best Practices

#### Relay Selection Strategy

1. **Diversity**: Use relays from different operators
2. **Geography**: Include relays in your target regions
3. **Performance**: Test relay response times
4. **Reliability**: Monitor relay uptime statistics

#### Cache Strategy

1. **Pre-populate**: Let the system run for a few hours to build cache
2. **Monitor**: Track cache hit rates and event processing
3. **Optimize**: Adjust TTL based on content update frequency
4. **Backup**: Consider cache warming strategies for new deployments

#### Error Handling

The system includes robust error handling:

- **Connection Failures**: Automatic reconnection with exponential backoff
- **Invalid Events**: Graceful handling of malformed events
- **Cache Errors**: Fallback to traditional query methods
- **Relay Timeouts**: Configurable timeout and retry mechanisms

### Integration with Other Systems

#### With Redis Clustering

```bash
# Redis cluster configuration
CACHE_PATH=redis://redis-cluster-endpoint:6379

# Enable cluster mode
REDIS_CLUSTER=true
```

#### With Load Balancers

```bash
# Share cache across multiple server instances
CACHE_PATH=redis://shared-redis:6379

# Enable real-time invalidation on all instances
REALTIME_CACHE_INVALIDATION=true
```

#### With Monitoring Systems

```bash
# Prometheus metrics endpoint
METRICS_ENABLED=true
METRICS_PORT=9090

# Export invalidation statistics
EXPORT_INVALIDATION_STATS=true
```

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
