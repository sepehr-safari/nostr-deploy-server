# Nostr Deploy - Server Implementation

A Node.js server implementation for serving static websites under npub subdomains using the Nostr protocol and Blossom servers. This server implements the [Pubkey Static Websites](https://nostrhub.io/naddr1qvzqqqrcvypzqfngzhsvjggdlgeycm96x4emzjlwf8dyyzdfg4hefp89zpkdgz99qqt8qatzddjhjttnw3shg6tr94mk2cnnd96x2uch7k70g) NIP specification, allowing decentralized hosting of static websites without storing any data locally.

## 🌟 Features

- **Decentralized Hosting**: Serves websites using Nostr events (kind 34128) for path mappings and Blossom servers for file storage
- **Npub Subdomains**: Supports `npub1xxx.example.com` wildcard subdomain routing
- **Zero Storage**: Acts as a pure proxy/gateway without storing any files locally
- **Intelligent Caching**: In-memory caching with TTL for improved performance
- **Automatic Fallbacks**: Falls back to `/404.html` for missing files and default servers when user configurations are unavailable

- **Rate Limiting**: Configurable rate limiting to prevent abuse
- **Graceful Shutdown**: Proper cleanup of connections and resources

## 📋 NIP Implementation

This server implements the [Pubkey Static Websites](https://nostrhub.io/naddr1qvzqqqrcvypzqfngzhsvjggdlgeycm96x4emzjlwf8dyyzdfg4hefp89zpkdgz99qqt8qatzddjhjttnw3shg6tr94mk2cnnd96x2uch7k70g) NIP which allows:

1. **Static File Events (Kind 34128)**: Maps file paths to SHA256 hashes

   ```json
   {
     "kind": 34128,
     "tags": [
       ["d", "/index.html"],
       ["x", "186ea5fd14e88fd1ac49351759e7ab906fa94892002b60bf7f5a428f28ca1c99"]
     ]
   }
   ```

2. **Relay Lists (Kind 10002)**: User's preferred Nostr relays (NIP-65)
3. **Blossom Server Lists (Kind 10063)**: User's preferred Blossom servers (BUD-03)

## 🚀 Quick Start

1. **Install dependencies:**

   ```bash
   npm install
   ```

2. **Configure environment variables:**

   ```bash
   cp env.example .env
   # Edit .env with your configuration
   ```

3. **Run in development mode:**

   ```bash
   npm run dev
   ```

4. **Build and run in production:**
   ```bash
   npm run build
   npm start
   ```

## 🔧 Advanced Caching System

This server features a sophisticated multi-layer caching system inspired by modern NoSQL and distributed caching patterns. The caching system supports multiple backends and provides significant performance improvements.

### Cache Backends

The server supports three cache backends:

1. **In-Memory Cache** (Default)

   ```bash
   CACHE_PATH=in-memory
   ```

2. **Redis Cache** (Recommended for production)

   ```bash
   CACHE_PATH=redis://localhost:6379
   # or with authentication:
   CACHE_PATH=redis://username:password@localhost:6379/0
   ```

3. **SQLite Cache** (Good for single-instance deployments)
   ```bash
   CACHE_PATH=sqlite:///path/to/cache.db
   ```

### Cache Layers

The caching system includes multiple specialized cache layers:

- **Domain Resolution Cache**: Maps domain names to pubkeys
- **Blossom Servers Cache**: Caches available blossom servers per pubkey
- **Relay Lists Cache**: Caches relay lists per pubkey
- **Path Mapping Cache**: Maps file paths to blob metadata
- **Blob URLs Cache**: Caches available URLs for each blob
- **File Content Cache**: Caches actual file content
- **Negative Cache**: Caches "not found" results to avoid repeated lookups

### Cache Configuration

Add these environment variables to your `.env` file:

```bash
# Advanced Caching Configuration
CACHE_PATH=in-memory          # or redis://... or sqlite://...
CACHE_TIME=3600              # Default TTL in seconds (1 hour)
```

### Testing the Cache System

Run the comprehensive cache test suite:

```bash
# Test all cache functionality
npm run test:cache

# Run all tests including cache tests
npm test

# Run tests in watch mode
npm run test:watch
```

### Complete Documentation

For comprehensive documentation on the caching system, see: **[📖 Caching Documentation](docs/CACHING.md)**

This includes:

- Detailed architecture overview
- Complete API reference
- Performance benchmarks
- Monitoring and troubleshooting guides
- Production deployment strategies

### Setting Up Redis Cache Backend

Redis is the recommended cache backend for production deployments as it provides persistence, horizontal scaling, and high performance.

#### Installing Redis

**macOS (using Homebrew):**

```bash
# Install Redis
brew install redis

# Start Redis service
brew services start redis

# Or start manually
redis-server
```

**Ubuntu/Debian:**

```bash
# Update package list
sudo apt update

# Install Redis
sudo apt install redis-server

# Start Redis service
sudo systemctl start redis-server
sudo systemctl enable redis-server

# Check Redis status
sudo systemctl status redis-server
```

**Docker (Recommended for development):**

```bash
# Run Redis in Docker
docker run -d --name redis-cache -p 6379:6379 redis:alpine

# With persistence
docker run -d --name redis-cache \
  -p 6379:6379 \
  -v redis-data:/data \
  redis:alpine redis-server --appendonly yes
```

**CentOS/RHEL/Rocky Linux:**

```bash
# Install EPEL repository
sudo dnf install epel-release

# Install Redis
sudo dnf install redis

# Start and enable Redis
sudo systemctl start redis
sudo systemctl enable redis
```

#### Redis Configuration

Create a Redis configuration for production:

```bash
# Create Redis config directory
sudo mkdir -p /etc/redis

# Create configuration file
sudo tee /etc/redis/redis.conf << EOF
# Network configuration
bind 127.0.0.1
port 6379
protected-mode yes

# Memory configuration
maxmemory 256mb
maxmemory-policy allkeys-lru

# Persistence configuration
save 900 1
save 300 10
save 60 10000

# Security
requirepass your-secure-password-here

# Logging
loglevel notice
logfile /var/log/redis/redis-server.log

# Performance
tcp-keepalive 300
timeout 0
EOF

# Restart Redis with new config
sudo systemctl restart redis
```

#### Environment Configuration for Redis

Add to your `.env` file:

```bash
# Basic Redis connection
CACHE_PATH=redis://localhost:6379

# Redis with password
CACHE_PATH=redis://:your-password@localhost:6379

# Redis with username and password (Redis 6+)
CACHE_PATH=redis://username:password@localhost:6379

# Redis with database selection
CACHE_PATH=redis://localhost:6379/0

# Redis with custom connection options
CACHE_PATH=redis://localhost:6379?retry_delay=100&max_attempts=3

# Redis cluster or remote server
CACHE_PATH=redis://redis.example.com:6379
```

#### Redis Monitoring

Monitor Redis performance:

```bash
# Connect to Redis CLI
redis-cli

# Monitor commands in real-time
redis-cli monitor

# Get Redis info
redis-cli info

# Check memory usage
redis-cli memory usage

# List all keys (use with caution in production)
redis-cli keys "*"

# Get cache statistics
redis-cli info stats
```

### Setting Up SQLite Cache Backend

SQLite is perfect for single-instance deployments or when you want persistent caching without setting up a Redis server.

#### Installing SQLite

SQLite comes pre-installed on most systems, but you can install it if needed:

**macOS:**

```bash
# Usually pre-installed, or install via Homebrew
brew install sqlite
```

**Ubuntu/Debian:**

```bash
sudo apt update
sudo apt install sqlite3
```

**CentOS/RHEL:**

```bash
sudo dnf install sqlite
```

#### SQLite Configuration

SQLite requires minimal configuration. Just specify the database file path:

```bash
# Environment configuration for SQLite
CACHE_PATH=sqlite:///var/lib/nostr-deploy/cache.db

# Or relative path
CACHE_PATH=sqlite://./data/cache.db

# In-memory SQLite (loses data on restart)
CACHE_PATH=sqlite://:memory:
```

#### Creating SQLite Cache Directory

```bash
# Create cache directory
sudo mkdir -p /var/lib/nostr-deploy
sudo chown $(whoami):$(whoami) /var/lib/nostr-deploy

# Or for local development
mkdir -p ./data
```

#### SQLite Performance Tuning

For better SQLite performance, create a configuration script:

```javascript
// SQLite performance optimization (optional)
// Add to your application startup code

import Database from 'better-sqlite3';

if (process.env.CACHE_PATH?.startsWith('sqlite://')) {
  const dbPath = process.env.CACHE_PATH.replace('sqlite://', '');
  const db = new Database(dbPath);

  // Performance optimizations
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA cache_size = 1000000;
    PRAGMA temp_store = memory;
    PRAGMA mmap_size = 268435456;
  `);

  db.close();
}
```

#### SQLite Monitoring

Monitor SQLite database:

```bash
# Connect to SQLite database
sqlite3 /var/lib/nostr-deploy/cache.db

# List tables
.tables

# Get database info
.dbinfo

# Check database size
.dbconfig

# Analyze database performance
ANALYZE;

# Vacuum database (optimize storage)
VACUUM;
```

### Cache Backend Comparison

| Feature              | In-Memory        | Redis        | SQLite            |
| -------------------- | ---------------- | ------------ | ----------------- |
| **Performance**      | Fastest          | Very Fast    | Fast              |
| **Persistence**      | None             | Yes          | Yes               |
| **Scalability**      | Single Process   | Horizontal   | Single Process    |
| **Memory Usage**     | High             | Configurable | Low               |
| **Setup Complexity** | None             | Medium       | Low               |
| **Production Ready** | Development Only | Yes          | Small-Medium Apps |
| **Network Overhead** | None             | Low          | None              |

### Cache Performance Benchmarks

Typical performance characteristics:

- **In-Memory**: ~1-2ms response time, 100,000+ ops/sec
- **Redis**: ~2-5ms response time, 50,000+ ops/sec
- **SQLite**: ~5-10ms response time, 10,000+ ops/sec

### Troubleshooting Cache Issues

**Redis Connection Issues:**

```bash
# Test Redis connection
redis-cli ping

# Check Redis logs
sudo tail -f /var/log/redis/redis-server.log

# Verify Redis is listening
sudo netstat -tlnp | grep 6379
```

**SQLite Permission Issues:**

```bash
# Fix file permissions
sudo chown -R $(whoami):$(whoami) /var/lib/nostr-deploy/
chmod 755 /var/lib/nostr-deploy/
chmod 644 /var/lib/nostr-deploy/cache.db
```

**Memory Issues:**

```bash
# Check Redis memory usage
redis-cli info memory

# Monitor system resources
htop
df -h
```

### Performance Benefits

The advanced caching system provides:

- **3-5x faster response times** for cached requests
- **Reduced load on Nostr relays** through intelligent caching
- **Lower bandwidth usage** with blob URL availability caching
- **Improved reliability** with negative caching for failed lookups
- **Horizontal scaling** support with Redis backend

## ⚙️ Configuration

Configure the server using environment variables or create a `.env` file:

```bash
# Server Configuration
PORT=3000
NODE_ENV=production

# Domain Configuration
BASE_DOMAIN=example.com

# Default Nostr Relays (comma-separated)
DEFAULT_RELAYS=wss://relay.nostr.band,wss://nostrue.com,wss://purplerelay.com,wss://relay.primal.net,wss://nos.lol,wss://relay.damus.io,wss://relay.nsite.lol

# Default Blossom Servers (comma-separated)
DEFAULT_BLOSSOM_SERVERS=https://cdn.hzrd149.com,https://blossom.primal.net,https://blossom.band,https://loratu.bitcointxoko.com,https://blossom.f7z.io,https://cdn.sovbit.host

# Caching Configuration
CACHE_TTL_SECONDS=300
MAX_CACHE_SIZE=100

# Rate Limiting
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100

# Security & Performance
CORS_ORIGIN=*
TRUST_PROXY=false
REQUEST_TIMEOUT_MS=30000
MAX_FILE_SIZE_MB=50
LOG_LEVEL=info
```

### SSL Certificate Setup

For production deployment, you need a wildcard SSL certificate:

```bash
# Example with Let's Encrypt/Certbot
certbot certonly --dns-cloudflare \
  --dns-cloudflare-credentials ~/.secrets/cloudflare.ini \
  -d "*.example.com" \
  -d "example.com"

# Update .env with certificate paths
WILDCARD_CERT_PATH=/etc/letsencrypt/live/example.com/fullchain.pem
WILDCARD_KEY_PATH=/etc/letsencrypt/live/example.com/privkey.pem
```

## 🌐 How It Works

### 1. Request Flow

```mermaid
sequenceDiagram
    participant Client
    participant Server
    participant Nostr as Nostr Relays
    participant Blossom as Blossom Servers

    Client->>Server: GET npub123.example.com/index.html
    Server->>Server: Resolve npub to pubkey
    Server->>Nostr: Fetch relay list (kind 10002)
    Server->>Nostr: Fetch file mapping (kind 34128)
    Server->>Nostr: Fetch Blossom servers (kind 10063)
    Server->>Blossom: Fetch file by SHA256
    Server->>Client: Serve file with headers
```

### 2. Path Resolution

- `/` → `/index.html`
- `/blog/` → `/blog/index.html`
- `/about` → `/about/index.html` (if no extension)
- Missing files → `/404.html` fallback

### 3. Caching Strategy

- **Path Mappings**: 5 minutes TTL
- **Relay Lists**: 5 minutes TTL
- **Blossom Server Lists**: 5 minutes TTL
- **File Content**: 30 minutes TTL
- **Error Results**: 1 minute TTL

## 🔌 API Endpoints

### Static File Serving

```bash
GET *
```

Main endpoint that serves static files based on npub subdomain routing.

## 🏗️ Architecture

### Project Structure

```
/
├── src/
│   ├── types/           # TypeScript type definitions
│   ├── utils/           # Utility classes (config, logger, cache)
│   ├── helpers/         # Core helpers (Nostr, Blossom)
│   ├── __tests__/       # Test files
│   └── server.ts        # Main server application
├── dist/                # Compiled JavaScript (generated)
├── package.json
├── tsconfig.json
├── jest.config.js
└── README.md
```

### Core Components

- **ConfigManager**: Environment configuration and validation
- **Logger**: Structured logging with Winston
- **MemoryCache**: TTL-based in-memory caching
- **NostrHelper**: Nostr relay communication and event parsing
- **BlossomHelper**: Blossom server file fetching
- **Express Server**: HTTP request handling and routing

## 🧪 Testing

The server includes comprehensive test coverage:

```bash
# Run all tests
npm test

# Run specific test files
npm test -- config.test.ts
npm test -- nostr.test.ts

# Run with coverage
npm test -- --coverage

# Watch mode for development
npm run test:watch
```

### Test Categories

- **Unit Tests**: Individual component testing
- **Integration Tests**: Component interaction testing
- **Mock Tests**: External service simulation
- **Configuration Tests**: Environment validation

## 🚀 Production Deployment

### Docker Deployment

```dockerfile
FROM node:18-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY dist/ ./dist/
COPY .env ./

EXPOSE 3000
CMD ["node", "dist/server.js"]
```

### Reverse Proxy Configuration

#### Nginx

```nginx
server {
    listen 443 ssl http2;
    server_name *.example.com;

    ssl_certificate /path/to/wildcard.crt;
    ssl_certificate_key /path/to/wildcard.key;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

#### Apache

```apache
<VirtualHost *:443>
    ServerName *.example.com
    ServerAlias *.example.com

    SSLEngine on
    SSLCertificateFile /path/to/wildcard.crt
    SSLCertificateKeyFile /path/to/wildcard.key

    ProxyPass / http://localhost:3000/
    ProxyPassReverse / http://localhost:3000/
    ProxyPreserveHost On
</VirtualHost>
```

### Process Management

#### PM2

```bash
# Install PM2
npm install -g pm2

# Start with PM2
pm2 start dist/server.js --name nostr-deploy-server

# Setup auto-restart
pm2 startup
pm2 save
```

#### Systemd

```ini
[Unit]
Description=Nostr Deploy Server
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/nostr-deploy-server
ExecStart=/usr/bin/node dist/server.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

## 🔧 Troubleshooting

### Common Issues

1. **Invalid npub subdomains returning 404**

   - Check BASE_DOMAIN configuration
   - Verify wildcard DNS setup
   - Ensure npub format is correct

2. **Files not loading from Blossom servers**

   - Check DEFAULT_BLOSSOM_SERVERS configuration
   - Verify network connectivity to Blossom servers
   - Check server logs for specific error messages

3. **Slow response times**

   - Increase CACHE_TTL_SECONDS
   - Increase MAX_CACHE_SIZE
   - Check network latency to relays/Blossom servers

4. **Rate limiting issues**
   - Adjust RATE_LIMIT_MAX_REQUESTS
   - Adjust RATE_LIMIT_WINDOW_MS
   - Implement IP whitelisting if needed

### Debug Mode

```bash
# Enable debug logging
LOG_LEVEL=debug npm start

# Check if server is running
curl http://localhost:3000
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes with tests
4. Ensure all tests pass: `npm test`
5. Submit a pull request

### Development Guidelines

- Follow TypeScript best practices
- Maintain test coverage above 80%
- Use meaningful commit messages
- Update documentation for new features

## 📄 License

MIT License - see LICENSE file for details.

## 🔗 Related Projects

- [Nostr Deploy CLI](https://github.com/sepehr-safari/nostr-deploy-cli) - CLI tool for deploying static sites
- [Nostr Protocol](https://github.com/nostr-protocol/nostr)
- [Blossom Protocol](https://github.com/hzrd149/blossom)

## 🙋‍♂️ Support

- Create an issue for bug reports
- Check existing issues before creating new ones
- Join the Nostr community for protocol discussions
