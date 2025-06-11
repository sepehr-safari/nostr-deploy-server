import axios, { AxiosResponse } from 'axios';
import * as mimeTypes from 'mime-types';
import { FileResponse } from '../types';
import { fileContentCache } from '../utils/cache';
import { ConfigManager } from '../utils/config';
import { logger } from '../utils/logger';

export class BlossomHelper {
  private config: ConfigManager;
  private requestTimeout: number;
  private maxFileSizeBytes: number;

  constructor() {
    this.config = ConfigManager.getInstance();
    const configData = this.config.getConfig();
    this.requestTimeout = configData.requestTimeoutMs;
    this.maxFileSizeBytes = configData.maxFileSizeMB * 1024 * 1024;
  }

  /**
   * Fetch file from Blossom servers
   */
  public async fetchFile(
    sha256: string,
    servers: string[],
    path?: string
  ): Promise<FileResponse | null> {
    // Check cache first
    const cacheKey = `file:${sha256}`;
    const cached = fileContentCache.get(cacheKey);
    if (cached) {
      logger.debug(`File cache hit for ${sha256.substring(0, 8)}...`);
      return {
        content: cached,
        contentType: this.getContentTypeFromPath(path || ''),
        contentLength: cached.length,
        sha256,
      };
    }

    // Try each server in sequence
    for (const server of servers) {
      try {
        const result = await this.fetchFromServer(server, sha256, path);
        if (result) {
          // Cache successful result
          fileContentCache.set(cacheKey, result.content, 1800000); // Cache for 30 minutes
          logger.logBlossom('fetchFile', sha256, server, true, {
            size: result.contentLength,
            contentType: result.contentType,
          });
          return result;
        }
      } catch (error) {
        logger.logBlossom('fetchFile', sha256, server, false, {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        continue; // Try next server
      }
    }

    logger.error(`Failed to fetch file ${sha256.substring(0, 8)}... from all servers`, {
      servers,
      serverCount: servers.length,
    });
    return null;
  }

  /**
   * Fetch file from a specific Blossom server
   */
  private async fetchFromServer(
    server: string,
    sha256: string,
    path?: string
  ): Promise<FileResponse | null> {
    try {
      // Ensure server URL doesn't end with slash
      const baseUrl = server.endsWith('/') ? server.slice(0, -1) : server;
      const url = `${baseUrl}/${sha256}`;

      logger.debug(`Fetching ${sha256.substring(0, 8)}... from ${server}`);

      const response: AxiosResponse = await axios.get(url, {
        timeout: this.requestTimeout,
        responseType: 'arraybuffer',
        maxContentLength: this.maxFileSizeBytes,
        maxBodyLength: this.maxFileSizeBytes,
        validateStatus: (status) => status === 200,
        headers: {
          'User-Agent': 'Nostr-Static-Server/1.0.0',
        },
      });

      if (!response.data) {
        throw new Error('Empty response body');
      }

      // Convert ArrayBuffer to Uint8Array
      const content = new Uint8Array(response.data);

      // Verify file size
      if (content.length > this.maxFileSizeBytes) {
        throw new Error(`File too large: ${content.length} bytes (max: ${this.maxFileSizeBytes})`);
      }

      // Get content type from response headers or guess from path
      let contentType =
        response.headers['content-type'] ||
        this.getContentTypeFromPath(path || '') ||
        'application/octet-stream';

      // Clean up content type (remove charset if present for binary files)
      if (contentType.includes(';') && !contentType.startsWith('text/')) {
        contentType = contentType.split(';')[0].trim();
      }

      // Get content length from response or calculate
      const contentLength =
        parseInt(response.headers['content-length'] || '0', 10) || content.length;

      // Validate SHA256 if we want to be extra cautious (optional)
      if (this.config.getConfig().maxFileSizeMB < 10) {
        // Only validate smaller files
        const calculatedHash = await this.calculateSHA256(content);
        if (calculatedHash !== sha256) {
          logger.warn(
            `SHA256 mismatch for file from ${server}: expected ${sha256}, got ${calculatedHash}`
          );
          // Don't throw error, just log warning as some servers might serve different content
        }
      }

      return {
        content,
        contentType,
        contentLength,
        sha256,
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const statusText = error.response?.statusText;

        if (status === 404) {
          throw new Error(`File not found: ${sha256}`);
        } else if (status === 413) {
          throw new Error(`File too large`);
        } else if (status === 429) {
          throw new Error(`Rate limited by server`);
        } else if (error.code === 'ECONNABORTED') {
          throw new Error(`Request timeout (${this.requestTimeout}ms)`);
        } else {
          throw new Error(`HTTP ${status} ${statusText}: ${error.message}`);
        }
      }
      throw error;
    }
  }

  /**
   * Get content type from file path
   */
  private getContentTypeFromPath(path: string): string {
    if (!path) return 'application/octet-stream';

    const contentType = mimeTypes.lookup(path);
    if (contentType) {
      return contentType;
    }

    // Fallback based on extension
    const ext = path.toLowerCase().split('.').pop();
    switch (ext) {
      case 'html':
      case 'htm':
        return 'text/html';
      case 'css':
        return 'text/css';
      case 'js':
        return 'application/javascript';
      case 'json':
        return 'application/json';
      case 'png':
        return 'image/png';
      case 'jpg':
      case 'jpeg':
        return 'image/jpeg';
      case 'gif':
        return 'image/gif';
      case 'svg':
        return 'image/svg+xml';
      case 'ico':
        return 'image/x-icon';
      case 'woff':
        return 'font/woff';
      case 'woff2':
        return 'font/woff2';
      case 'ttf':
        return 'font/ttf';
      case 'eot':
        return 'application/vnd.ms-fontobject';
      case 'pdf':
        return 'application/pdf';
      case 'txt':
        return 'text/plain';
      case 'md':
        return 'text/markdown';
      case 'xml':
        return 'application/xml';
      case 'zip':
        return 'application/zip';
      case 'tar':
        return 'application/x-tar';
      case 'gz':
        return 'application/gzip';
      default:
        return 'application/octet-stream';
    }
  }

  /**
   * Calculate SHA256 hash of content
   */
  private async calculateSHA256(content: Uint8Array): Promise<string> {
    // Use Web Crypto API if available (Node.js 16+)
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const hashBuffer = await crypto.subtle.digest('SHA-256', content);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    }

    // Fallback to Node.js crypto module
    const nodeCrypto = require('crypto');
    const hash = nodeCrypto.createHash('sha256');
    hash.update(content);
    return hash.digest('hex');
  }

  /**
   * Check if a server is reachable
   */
  public async checkServerHealth(server: string): Promise<boolean> {
    try {
      const baseUrl = server.endsWith('/') ? server.slice(0, -1) : server;
      const response = await axios.head(baseUrl, {
        timeout: 5000,
        validateStatus: (status) => status < 500, // Accept any status that's not a server error
      });

      return response.status < 500;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get server statistics
   */
  public async getServerStats(servers: string[]): Promise<{
    total: number;
    healthy: number;
    unhealthy: number;
    healthyServers: string[];
    unhealthyServers: string[];
  }> {
    const healthChecks = await Promise.allSettled(
      servers.map(async (server) => ({
        server,
        healthy: await this.checkServerHealth(server),
      }))
    );

    const results = healthChecks
      .filter(
        (result): result is PromiseFulfilledResult<{ server: string; healthy: boolean }> =>
          result.status === 'fulfilled'
      )
      .map((result) => result.value);

    const healthyServers = results.filter((r) => r.healthy).map((r) => r.server);
    const unhealthyServers = results.filter((r) => !r.healthy).map((r) => r.server);

    return {
      total: servers.length,
      healthy: healthyServers.length,
      unhealthy: unhealthyServers.length,
      healthyServers,
      unhealthyServers,
    };
  }
}
