import { nip19, SimplePool } from 'nostr-tools';
import 'websocket-polyfill';
import {
  BlossomServerListEvent,
  NostrEvent,
  PubkeyResolution,
  RelayListEvent,
  StaticFileEvent,
} from '../types';
import { blossomServerCache, pathMappingCache, relayListCache } from '../utils/cache';
import { ConfigManager } from '../utils/config';
import { logger } from '../utils/logger';

interface RelayConnection {
  url: string;
  lastUsed: number;
  isConnected: boolean;
  connectionPromise?: Promise<void>;
}

export class NostrHelper {
  private pool: SimplePool;
  private config: ConfigManager;
  private connections: Map<string, RelayConnection> = new Map();
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    this.pool = new SimplePool();
    this.config = ConfigManager.getInstance();

    const configData = this.config.getConfig();

    // Start cleanup interval to remove stale connections
    this.cleanupInterval = setInterval(() => {
      this.cleanupStaleConnections();
    }, configData.wsCleanupIntervalMs);
  }

  /**
   * Ensure connection to a relay is established and keep it alive
   */
  private async ensureConnection(relayUrl: string): Promise<void> {
    const existing = this.connections.get(relayUrl);
    const now = Date.now();
    const configData = this.config.getConfig();

    // If connection exists and is recent, reuse it
    if (
      existing &&
      existing.isConnected &&
      now - existing.lastUsed < configData.wsConnectionTimeoutMs
    ) {
      existing.lastUsed = now;
      return;
    }

    // If there's already a connection attempt in progress, wait for it
    if (existing?.connectionPromise) {
      await existing.connectionPromise;
      if (existing.isConnected) {
        existing.lastUsed = now;
        return;
      }
    }

    // Create new connection
    const connection: RelayConnection = {
      url: relayUrl,
      lastUsed: now,
      isConnected: false,
    };

    this.connections.set(relayUrl, connection);

    // Create connection promise
    connection.connectionPromise = new Promise<void>((resolve, reject) => {
      try {
        // The SimplePool handles the actual WebSocket connection internally
        // We just need to track that we've "connected" to this relay
        connection.isConnected = true;
        connection.lastUsed = now;
        logger.debug(`Established connection to relay: ${relayUrl}`);
        resolve();
      } catch (error) {
        logger.error(`Failed to connect to relay ${relayUrl}:`, error);
        connection.isConnected = false;
        reject(error);
      }
    });

    await connection.connectionPromise;
    connection.connectionPromise = undefined;
  }

  /**
   * Clean up stale connections that haven't been used for over an hour
   */
  private cleanupStaleConnections(): void {
    const now = Date.now();
    const staleRelays: string[] = [];
    const configData = this.config.getConfig();

    for (const [relayUrl, connection] of this.connections.entries()) {
      if (now - connection.lastUsed > configData.wsConnectionTimeoutMs) {
        staleRelays.push(relayUrl);
        this.connections.delete(relayUrl);
      }
    }

    if (staleRelays.length > 0) {
      try {
        this.pool.close(staleRelays);
        logger.debug(`Cleaned up ${staleRelays.length} stale relay connections`);
      } catch (error) {
        logger.error('Error closing stale connections:', error);
      }
    }
  }

  /**
   * Get active connections for the specified relays, establishing new ones if needed
   */
  private async getActiveRelays(relays: string[]): Promise<string[]> {
    const activeRelays: string[] = [];

    // Establish connections to all relays in parallel
    const connectionPromises = relays.map(async (relay) => {
      try {
        await this.ensureConnection(relay);
        const connection = this.connections.get(relay);
        if (connection?.isConnected) {
          activeRelays.push(relay);
        }
      } catch (error) {
        logger.warn(`Failed to connect to relay ${relay}:`, error);
      }
    });

    await Promise.allSettled(connectionPromises);
    return activeRelays;
  }

  /**
   * Resolve npub subdomain to pubkey
   */
  public resolvePubkey(hostname: string): PubkeyResolution {
    const config = this.config.getConfig();
    const baseDomain = config.baseDomain;

    // Extract subdomain
    const subdomain = hostname.replace(`.${baseDomain}`, '');

    // Check if it's an npub subdomain
    if (subdomain.startsWith('npub1')) {
      try {
        const decoded = nip19.decode(subdomain);
        if (decoded.type === 'npub') {
          const pubkey = decoded.data as string;
          return {
            pubkey,
            npub: subdomain,
            subdomain,
            isValid: true,
          };
        }
      } catch (error) {
        logger.error(`Invalid npub in subdomain: ${subdomain}`, { error });
      }
    }

    return {
      pubkey: '',
      subdomain,
      isValid: false,
    };
  }

  /**
   * Get relay list for a pubkey (NIP-65)
   */
  public async getRelayList(pubkey: string): Promise<string[]> {
    const cacheKey = `relays:${pubkey}`;
    const cached = relayListCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const config = this.config.getConfig();
    const relays = config.defaultRelays;

    try {
      logger.debug(`Fetching relay list for pubkey: ${pubkey.substring(0, 8)}...`);

      const filter = {
        authors: [pubkey],
        kinds: [10002],
        limit: 1,
      };

      const events = await this.queryRelays(relays, filter, 5000);

      if (events.length === 0) {
        logger.debug(
          `No relay list found for pubkey: ${pubkey.substring(0, 8)}..., using defaults`
        );
        relayListCache.set(cacheKey, relays, 300000); // Cache for 5 minutes
        return relays;
      }

      const event = events[0] as RelayListEvent;
      const userRelays: string[] = [];

      // Parse relay tags
      for (const tag of event.tags) {
        if (tag[0] === 'r' && tag[1]) {
          const relayUrl = tag[1];
          const relayType = tag[2]; // 'read', 'write', or undefined (both)

          // Only include read relays or unspecified (both)
          if (!relayType || relayType === 'read') {
            userRelays.push(relayUrl);
          }
        }
      }

      const finalRelays = userRelays.length > 0 ? userRelays : relays;
      relayListCache.set(cacheKey, finalRelays, 300000); // Cache for 5 minutes

      logger.logNostr('getRelayList', pubkey, true, { relayCount: finalRelays.length });
      return finalRelays;
    } catch (error) {
      logger.logNostr('getRelayList', pubkey, false, {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      // Return default relays on error
      relayListCache.set(cacheKey, relays, 60000); // Cache for 1 minute on error
      return relays;
    }
  }

  /**
   * Get Blossom server list for a pubkey (BUD-03)
   */
  public async getBlossomServers(pubkey: string): Promise<string[]> {
    const cacheKey = `blossom:${pubkey}`;
    const cached = blossomServerCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const userRelays = await this.getRelayList(pubkey);

    try {
      logger.debug(`Fetching Blossom servers for pubkey: ${pubkey.substring(0, 8)}...`);

      const filter = {
        authors: [pubkey],
        kinds: [10063],
        limit: 1,
      };

      const events = await this.queryRelays(userRelays, filter, 10000);

      if (events.length === 0) {
        logger.debug(
          `No Blossom servers found for pubkey: ${pubkey.substring(0, 8)}..., using defaults`
        );
        const config = this.config.getConfig();
        const defaultServers = config.defaultBlossomServers;
        blossomServerCache.set(cacheKey, defaultServers, 300000); // Cache for 5 minutes
        return defaultServers;
      }

      const event = events[0] as BlossomServerListEvent;
      const servers: string[] = [];

      // Parse server tags
      for (const tag of event.tags) {
        if (tag[0] === 'server' && tag[1]) {
          servers.push(tag[1]);
        }
      }

      const config = this.config.getConfig();
      const finalServers = servers.length > 0 ? servers : config.defaultBlossomServers;
      blossomServerCache.set(cacheKey, finalServers, 300000); // Cache for 5 minutes

      logger.logNostr('getBlossomServers', pubkey, true, { serverCount: finalServers.length });
      return finalServers;
    } catch (error) {
      logger.logNostr('getBlossomServers', pubkey, false, {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      // Return default servers on error
      const config = this.config.getConfig();
      const defaultServers = config.defaultBlossomServers;
      blossomServerCache.set(cacheKey, defaultServers, 60000); // Cache for 1 minute on error
      return defaultServers;
    }
  }

  /**
   * Get static file mapping for a specific path (kind 34128)
   */
  public async getStaticFileMapping(pubkey: string, path: string): Promise<string | null> {
    const cacheKey = `mapping:${pubkey}:${path}`;
    const cached = pathMappingCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const userRelays = await this.getRelayList(pubkey);

    try {
      logger.debug(`Fetching file mapping for ${path} from pubkey: ${pubkey.substring(0, 8)}...`);

      const filter = {
        authors: [pubkey],
        kinds: [34128],
        '#d': [path],
        limit: 1,
      };

      // Try with user relays first
      let events = await this.queryRelays(userRelays, filter, 10000);

      // If no events found and we have user relays, also try default relays as fallback
      if (events.length === 0 && userRelays.length > 0) {
        const config = this.config.getConfig();
        const defaultRelays = config.defaultRelays.filter((relay) => !userRelays.includes(relay));
        if (defaultRelays.length > 0) {
          logger.debug(`No mapping found on user relays, trying default relays for ${path}`);
          events = await this.queryRelays(defaultRelays, filter, 10000);
        }
      }

      if (events.length === 0) {
        // Try fallback to /404.html if not found
        if (path !== '/404.html') {
          logger.debug(`No mapping found for ${path}, trying /404.html fallback`);
          return this.getStaticFileMapping(pubkey, '/404.html');
        }

        logger.debug(`No file mapping found for ${path} from pubkey: ${pubkey.substring(0, 8)}...`);
        pathMappingCache.set(cacheKey, '', 10000); // Cache negative result for only 10 seconds
        return null;
      }

      const event = events[0] as StaticFileEvent;
      let sha256: string | null = null;

      // Find the x tag containing the SHA256 hash
      for (const tag of event.tags) {
        if (tag[0] === 'x' && tag[1]) {
          sha256 = tag[1];
          break;
        }
      }

      if (!sha256) {
        logger.error(`Static file event missing SHA256 hash for path: ${path}`);
        pathMappingCache.set(cacheKey, '', 10000); // Cache negative result for only 10 seconds
        return null;
      }

      pathMappingCache.set(cacheKey, sha256, 300000); // Cache for 5 minutes
      logger.logNostr('getStaticFileMapping', pubkey, true, {
        path,
        sha256: sha256.substring(0, 8) + '...',
      });
      return sha256;
    } catch (error) {
      logger.logNostr('getStaticFileMapping', pubkey, false, {
        path,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      pathMappingCache.set(cacheKey, '', 10000); // Cache negative result for only 10 seconds
      return null;
    }
  }

  /**
   * Query multiple relays with timeout using persistent connections
   */
  private async queryRelays(
    relays: string[],
    filter: any,
    timeoutMs: number = 10000
  ): Promise<NostrEvent[]> {
    // Ensure connections are established
    const activeRelays = await this.getActiveRelays(relays);

    if (activeRelays.length === 0) {
      logger.warn('No active relay connections available for query', { relays });
      return [];
    }

    logger.debug(`Querying ${activeRelays.length}/${relays.length} active relays`, {
      active: activeRelays,
      total: relays.length,
    });

    return new Promise((resolve, reject) => {
      const events: NostrEvent[] = [];
      const timeout = setTimeout(() => {
        resolve(events); // Return what we have so far instead of rejecting
      }, timeoutMs);

      let completedRelays = 0;
      const totalRelays = activeRelays.length;

      if (totalRelays === 0) {
        clearTimeout(timeout);
        resolve(events);
        return;
      }

      try {
        const sub = this.pool.subscribeMany(activeRelays, [filter], {
          onevent(event) {
            events.push(event);
          },
          oneose() {
            completedRelays++;
            if (completedRelays === totalRelays) {
              clearTimeout(timeout);
              sub.close();
              resolve(events);
            }
          },
          onclose() {
            completedRelays++;
            if (completedRelays === totalRelays) {
              clearTimeout(timeout);
              resolve(events);
            }
          },
        });

        // Update last used time for all active relays
        const now = Date.now();
        activeRelays.forEach((relay) => {
          const connection = this.connections.get(relay);
          if (connection) {
            connection.lastUsed = now;
          }
        });
      } catch (error) {
        logger.error('Error querying relays:', error);
        clearTimeout(timeout);
        resolve(events);
      }
    });
  }

  /**
   * Close connections to specific relays
   */
  private closeConnections(relays: string[]): void {
    try {
      this.pool.close(relays);
      relays.forEach((relay) => {
        this.connections.delete(relay);
      });
    } catch (error) {
      logger.error('Error closing relay connections:', error);
    }
  }

  /**
   * Close all connections and cleanup
   */
  public closeAllConnections(): void {
    try {
      // Clear the cleanup interval
      if (this.cleanupInterval) {
        clearInterval(this.cleanupInterval);
      }

      // Close all active connections
      const allRelays = Array.from(this.connections.keys());
      if (allRelays.length > 0) {
        this.pool.close(allRelays);
      }

      this.connections.clear();
      logger.info('All Nostr relay connections closed');
    } catch (error) {
      logger.error('Error closing all relay connections:', error);
    }
  }

  /**
   * Get connection statistics
   */
  public getStats(): { activeConnections: number; connectedRelays: string[] } {
    const connectedRelays = Array.from(this.connections.values())
      .filter((conn) => conn.isConnected)
      .map((conn) => conn.url);

    return {
      activeConnections: connectedRelays.length,
      connectedRelays: connectedRelays,
    };
  }
}
