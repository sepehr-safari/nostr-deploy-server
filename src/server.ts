import cors from 'cors';
import express, { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { BlossomHelper } from './helpers/blossom';
import { NostrHelper } from './helpers/nostr';
import { SimpleSSRHelper } from './helpers/ssr-simple';
import { ConfigManager } from './utils/config';
import { logger } from './utils/logger';

// Initialize components
const configManager = ConfigManager.getInstance();
const config = configManager.getConfig();
const nostrHelper = new NostrHelper();
const blossomHelper = new BlossomHelper();
const ssrHelper = new SimpleSSRHelper();

// Create Express app
const app = express();

// Security middleware
app.use(
  helmet({
    contentSecurityPolicy: false, // Allow inline scripts for static sites
    crossOriginEmbedderPolicy: false, // Allow embedding
    frameguard: false, // Allow embedding in iframes
  })
);

// CORS configuration
app.use(
  cors({
    origin: config.corsOrigin,
    credentials: true,
  })
);

// Trust proxy if configured
if (config.trustProxy) {
  app.set('trust proxy', 1);
}

// Request logging middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const userAgent = req.get('User-Agent') || '';
    logger.logRequest(req.method, req.url, res.statusCode, duration, userAgent);
  });

  next();
});

// Rate limiting middleware (simple in-memory implementation)
const requestCounts = new Map<string, { count: number; resetTime: number }>();

app.use((req: Request, res: Response, next: NextFunction) => {
  const clientIp = req.ip || req.connection.remoteAddress || 'unknown';
  const now = Date.now();
  const windowMs = config.rateLimitWindowMs;
  const maxRequests = config.rateLimitMaxRequests;

  // Clean up old entries
  for (const [ip, data] of requestCounts.entries()) {
    if (now > data.resetTime) {
      requestCounts.delete(ip);
    }
  }

  // Get or create entry for this IP
  let entry = requestCounts.get(clientIp);
  if (!entry || now > entry.resetTime) {
    entry = { count: 0, resetTime: now + windowMs };
    requestCounts.set(clientIp, entry);
  }

  // Check rate limit
  if (entry.count >= maxRequests) {
    logger.warn(`Rate limit exceeded for IP: ${clientIp}`);
    res.status(429).json({
      error: 'Too Many Requests',
      message: 'Rate limit exceeded. Please try again later.',
      retryAfter: Math.ceil((entry.resetTime - now) / 1000),
    });
    return;
  }

  entry.count++;
  next();
});

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  const nostrStats = nostrHelper.getStats();

  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    nostr: {
      activeConnections: nostrStats.activeConnections,
      connectedRelays: nostrStats.connectedRelays.length,
    },
    config: {
      baseDomain: config.baseDomain,
      defaultRelays: config.defaultRelays.length,
      defaultBlossomServers: config.defaultBlossomServers.length,
    },
  });
});

// Admin stats endpoint
app.get('/admin/stats', async (req: Request, res: Response) => {
  try {
    const nostrStats = nostrHelper.getStats();
    const blossomStats = await blossomHelper.getServerStats(config.defaultBlossomServers);
    const ssrStats = await ssrHelper.getBrowserStats();

    res.json({
      timestamp: new Date().toISOString(),
      server: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        nodeVersion: process.version,
      },
      nostr: {
        activeConnections: nostrStats.activeConnections,
        connectedRelays: nostrStats.connectedRelays,
      },
      blossom: blossomStats,
      ssr: {
        browserConnected: ssrStats.isConnected,
        activePagesCount: ssrStats.pagesCount,
      },
      rateLimit: {
        activeIPs: requestCounts.size,
        windowMs: config.rateLimitWindowMs,
        maxRequests: config.rateLimitMaxRequests,
      },
    });
  } catch (error) {
    logger.error('Error getting admin stats:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Main request handler for static files
app.get('*', async (req: Request, res: Response) => {
  const hostname = req.hostname;
  const requestPath = req.path;

  try {
    // Resolve pubkey from hostname
    const pubkeyResolution = nostrHelper.resolvePubkey(hostname);

    if (!pubkeyResolution.isValid) {
      logger.warn(`Invalid npub subdomain: ${hostname}`);
      res.status(404).json({
        error: 'Not Found',
        message: 'Invalid npub subdomain',
      });
      return;
    }

    const { pubkey } = pubkeyResolution;

    // Normalize path - add index.html if path ends with /
    let normalizedPath = requestPath;
    if (normalizedPath.endsWith('/')) {
      normalizedPath += 'index.html';
    } else if (!normalizedPath.includes('.')) {
      // If no extension, assume it's a directory and add /index.html
      normalizedPath += '/index.html';
    }

    logger.debug(`Serving ${normalizedPath} for pubkey: ${pubkey.substring(0, 8)}...`);

    // Get file mapping from Nostr
    const sha256 = await nostrHelper.getStaticFileMapping(pubkey, normalizedPath);

    if (!sha256) {
      logger.warn(
        `No file mapping found for ${normalizedPath} from pubkey: ${pubkey.substring(0, 8)}...`,
        {
          hostname,
          path: normalizedPath,
          pubkey: pubkey.substring(0, 16) + '...',
          userAgent: req.get('User-Agent'),
        }
      );
      res.status(404).json({
        error: 'Not Found',
        message: 'File not found',
      });
      return;
    }

    // Get Blossom servers for this pubkey
    const blossomServers = await nostrHelper.getBlossomServers(pubkey);

    if (blossomServers.length === 0) {
      logger.error(`No Blossom servers available for pubkey: ${pubkey.substring(0, 8)}...`);
      res.status(404).json({
        error: 'Not Found',
        message: 'No Blossom servers available',
      });
      return;
    }

    // Fetch file from Blossom servers
    const fileResponse = await blossomHelper.fetchFile(sha256, blossomServers, normalizedPath);

    if (!fileResponse) {
      logger.error(`Failed to fetch file ${sha256.substring(0, 8)}... from Blossom servers`);
      res.status(404).json({
        error: 'Not Found',
        message: 'File not available from Blossom servers',
      });
      return;
    }

    // Check if this file should be SSR rendered
    const shouldSSR = ssrHelper.shouldRenderSSR(
      fileResponse.contentType,
      normalizedPath,
      req.get('User-Agent')
    );
    const fullUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;

    let finalContent: string | Buffer;
    let finalContentType: string;
    let finalContentLength: number;

    if (shouldSSR) {
      logger.debug(`SSR rendering ${normalizedPath} for ${hostname}`);

      try {
        // Use SSR to render the page
        const ssrResult = await ssrHelper.renderPage(
          fullUrl,
          Buffer.from(fileResponse.content),
          fileResponse.contentType
        );

        finalContent = ssrResult.html;
        finalContentType = ssrResult.contentType;
        finalContentLength = Buffer.byteLength(finalContent, 'utf8');

        logger.info(`SSR completed for ${normalizedPath} (${finalContentLength} bytes)`);
      } catch (ssrError) {
        logger.error(
          `SSR failed for ${normalizedPath}, falling back to original content:`,
          ssrError
        );
        // Fallback to original content
        finalContent = Buffer.from(fileResponse.content);
        finalContentType = fileResponse.contentType;
        finalContentLength = fileResponse.contentLength;
      }
    } else {
      // Use original content for non-HTML files
      finalContent = Buffer.from(fileResponse.content);
      finalContentType = fileResponse.contentType;
      finalContentLength = fileResponse.contentLength;

      // Log content type for debugging
      logger.debug(`Serving asset ${normalizedPath} with content-type: ${finalContentType}`);
    }

    // Set response headers
    res.set({
      'Content-Type': finalContentType,
      'Content-Length': finalContentLength.toString(),
      'Cache-Control': shouldSSR
        ? `public, max-age=${config.ssrCacheTtlSeconds}`
        : 'public, max-age=3600', // Use config for SSR cache
      ETag: `"${sha256}${shouldSSR ? '-ssr' : ''}"`,
      'X-Content-SHA256': sha256,
      'X-Served-By': 'Nostr-Static-Server',
      'X-SSR-Rendered': shouldSSR ? 'true' : 'false',
    });

    // Handle conditional requests
    const ifNoneMatch = req.get('If-None-Match');
    const expectedETag = `"${sha256}${shouldSSR ? '-ssr' : ''}"`;
    if (ifNoneMatch === expectedETag) {
      res.status(304).end();
      return;
    }

    // Send file content
    if (typeof finalContent === 'string') {
      res.send(finalContent);
    } else {
      res.send(finalContent);
    }

    logger.info(
      `Successfully served ${normalizedPath} (${finalContentLength} bytes${
        shouldSSR ? ', SSR rendered' : ''
      }) for pubkey: ${pubkey.substring(0, 8)}...`
    );
  } catch (error) {
    logger.error(`Error serving request for ${hostname}${requestPath}:`, error);

    // Return appropriate error response
    if (error instanceof Error) {
      if (error.message.includes('timeout')) {
        res.status(504).json({
          error: 'Gateway Timeout',
          message: 'Request timed out',
        });
        return;
      } else if (error.message.includes('Rate limited')) {
        res.status(429).json({
          error: 'Too Many Requests',
          message: 'Rate limited by upstream server',
        });
        return;
      }
    }

    res.status(500).json({
      error: 'Internal Server Error',
      message: 'An unexpected error occurred',
    });
  }
});

// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  logger.error('Unhandled error:', err);

  if (res.headersSent) {
    return next(err);
  }

  res.status(500).json({
    error: 'Internal Server Error',
    message: 'An unexpected error occurred',
  });
});

// Graceful shutdown
const server = app.listen(config.port, () => {
  logger.info(`Nostr Static Server listening on port ${config.port}`);
  logger.info(`Base domain: ${config.baseDomain}`);
  logger.info(`Default relays: ${config.defaultRelays.length}`);
  logger.info(`Default Blossom servers: ${config.defaultBlossomServers.length}`);
});

// Handle graceful shutdown
const gracefulShutdown = () => {
  logger.info('Shutting down gracefully...');

  server.close(() => {
    logger.info('HTTP server closed');

    // Close Nostr connections
    nostrHelper.closeAllConnections();

    // Close SSR browser
    ssrHelper.close().catch((error) => {
      logger.error('Error closing SSR helper:', error);
    });

    // Clean up caches
    const {
      pathMappingCache,
      relayListCache,
      blossomServerCache,
      fileContentCache,
    } = require('./utils/cache');
    pathMappingCache.destroy();
    relayListCache.destroy();
    blossomServerCache.destroy();
    fileContentCache.destroy();

    logger.info('Cleanup completed');
    process.exit(0);
  });
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

export default app;
