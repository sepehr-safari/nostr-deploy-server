# Example Usage Guide

This guide demonstrates how to use the Nostr Static Website Server to host a website under an npub subdomain.

## Prerequisites

Before using this server, you need:

1. **A static website deployed using the Nostr Deploy CLI** (see `/cli` directory)
2. **Valid Nostr events** published to relays:
   - Kind 34128 events mapping file paths to SHA256 hashes
   - Kind 10002 relay list (optional, will use defaults)
   - Kind 10063 Blossom server list (optional, will use defaults)
3. **Files uploaded to Blossom servers** with matching SHA256 hashes

## Example Nostr Events

### 1. Static File Mapping (Kind 34128)

```json
{
  "id": "5324d695ed7abf7cdd2a48deb881c93b7f4e43de702989bbfb55a1b97b35a3de",
  "pubkey": "266815e0c9210dfa324c6cba3573b14bee49da4209a9456f9484e5106cd408a5",
  "created_at": 1727373475,
  "kind": 34128,
  "content": "",
  "tags": [
    ["d", "/index.html"],
    ["x", "186ea5fd14e88fd1ac49351759e7ab906fa94892002b60bf7f5a428f28ca1c99"]
  ],
  "sig": "f4e4a9e785f70e9fcaa855d769438fea10781e84cd889e3fcb823774f83d094c..."
}
```

### 2. Relay List (Kind 10002) - Optional

```json
{
  "id": "relay-list-event-id",
  "pubkey": "266815e0c9210dfa324c6cba3573b14bee49da4209a9456f9484e5106cd408a5",
  "created_at": 1727373475,
  "kind": 10002,
  "content": "",
  "tags": [
    ["r", "wss://nos.lol", "read"],
    ["r", "wss://ditto.pub/relay"],
    ["r", "wss://relay.damus.io", "read"]
  ],
  "sig": "signature..."
}
```

### 3. Blossom Server List (Kind 10063) - Optional

```json
{
  "id": "blossom-list-event-id",
  "pubkey": "266815e0c9210dfa324c6cba3573b14bee49da4209a9456f9484e5106cd408a5",
  "created_at": 1727373475,
  "kind": 10063,
  "content": "",
  "tags": [
    ["server", "https://cdn.hzrd149.com"],
    ["server", "https://my-custom-blossom.com"]
  ],
  "sig": "signature..."
}
```

## Server Setup

### 1. Environment Configuration

Create a `.env` file:

```bash
# Server Configuration
PORT=3000
NODE_ENV=production
BASE_DOMAIN=npubsites.com

# Default relays (used when user has no relay list)
DEFAULT_RELAYS=wss://relay.nostr.band,wss://nostrue.com,wss://purplerelay.com,wss://relay.primal.net,wss://nos.lol,wss://relay.damus.io,wss://relay.nsite.lol

# Default Blossom servers (used when user has no server list)
DEFAULT_BLOSSOM_SERVERS=https://cdn.hzrd149.com,https://blossom.primal.net,https://blossom.band,https://loratu.bitcointxoko.com,https://blossom.f7z.io,https://cdn.sovbit.host

# Performance settings
CACHE_TTL_SECONDS=300
MAX_CACHE_SIZE=100
REQUEST_TIMEOUT_MS=30000
```

### 2. Start the Server

```bash
# Development
npm run dev

# Production
npm run build
npm start
```

### 3. DNS Configuration

Set up a wildcard DNS record:

```
*.npubsites.com A 1.2.3.4
```

### 4. SSL Certificate

Obtain a wildcard SSL certificate:

```bash
# Using Let's Encrypt
certbot certonly --dns-cloudflare \
  -d "*.npubsites.com" \
  -d "npubsites.com"
```

## Example Request Flow

### 1. User visits website

```
https://npub1yf5pr8xfy58058jxde48x4an905wnfzq28m54mex0pvsdcrxqsrq8ppkzc.npubsites.com/
```

### 2. Server resolves npub to pubkey

```
npub1yf5pr8xfy58058jxde48x4an905wnfzq28m54mex0pvsdcrxqsrq8ppkzc
↓
266815e0c9210dfa324c6cba3573b14bee49da4209a9456f9484e5106cd408a5
```

### 3. Server normalizes path

```
/ → /index.html
```

### 4. Server fetches relay list

```
Query: kind 10002, authors: [pubkey]
Result: ["wss://nos.lol", "wss://ditto.pub/relay"]
```

### 5. Server fetches file mapping

```
Query: kind 34128, authors: [pubkey], #d: ["/index.html"]
Result: x tag = "186ea5fd14e88fd1ac49351759e7ab906fa94892002b60bf7f5a428f28ca1c99"
```

### 6. Server fetches Blossom servers

```
Query: kind 10063, authors: [pubkey]
Result: ["https://cdn.hzrd149.com"]
```

### 7. Server fetches file from Blossom

```
GET https://cdn.hzrd149.com/186ea5fd14e88fd1ac49351759e7ab906fa94892002b60bf7f5a428f28ca1c99
```

### 8. Server serves file

```
HTTP/1.1 200 OK
Content-Type: text/html
Content-Length: 1234
Cache-Control: public, max-age=3600
ETag: "186ea5fd14e88fd1ac49351759e7ab906fa94892002b60bf7f5a428f28ca1c99"
X-Content-SHA256: 186ea5fd14e88fd1ac49351759e7ab906fa94892002b60bf7f5a428f28ca1c99
X-Served-By: Nostr-Static-Server

<!DOCTYPE html>
<html>...
```

## Testing the Server

### 1. Test Static File Serving

```bash
# Replace with a real npub subdomain
curl -H "Host: npub1test.npubsites.com" http://localhost:3000/
```

## Error Scenarios

### 1. Invalid npub subdomain

```bash
curl -H "Host: invalid.npubsites.com" http://localhost:3000/
```

Response:

```json
{
  "error": "Not Found",
  "message": "Invalid npub subdomain"
}
```

### 2. File not found

```bash
curl -H "Host: npub1valid.npubsites.com" http://localhost:3000/nonexistent.html
```

The server will:

1. Look for `/nonexistent.html` mapping
2. Fall back to `/404.html` mapping
3. Return 404 if no fallback exists

### 3. Blossom server unavailable

If all Blossom servers are unreachable:

```json
{
  "error": "Not Found",
  "message": "File not available from Blossom servers"
}
```

## Performance Monitoring

### Cache Hit Rates

Monitor cache performance:

```bash
# Cache performance is monitored via server logs
```

### Response Times

The server logs response times for all requests:

```
2024-01-15 10:30:00 [http]: GET /index.html 200 150ms
```

## Production Deployment

### Nginx Configuration

```nginx
server {
    listen 443 ssl http2;
    server_name *.npubsites.com;

    ssl_certificate /path/to/wildcard.crt;
    ssl_certificate_key /path/to/wildcard.key;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Enable caching for static assets
        proxy_cache_valid 200 1h;
    }
}
```

### Process Management with PM2

```bash
# Start the server
pm2 start dist/server.js --name nostr-static-server

# Monitor
pm2 monit

# View logs
pm2 logs nostr-static-server
```

## Troubleshooting

### Debug Mode

Enable detailed logging:

```bash
LOG_LEVEL=debug npm start
```

### Common Issues

1. **DNS not resolving**: Check wildcard DNS record
2. **SSL errors**: Verify certificate paths and permissions
3. **Slow responses**: Check relay and Blossom server connectivity
4. **File not found**: Verify Nostr events are published and Blossom files exist
5. **Memory issues**: Tune cache settings (`MAX_CACHE_SIZE`, `CACHE_TTL_SECONDS`)

### Log Analysis

```bash
# Follow logs in real-time
tail -f logs/combined.log

# Search for errors
grep "ERROR" logs/combined.log

# Monitor specific npub
grep "npub1abc123" logs/combined.log
```
