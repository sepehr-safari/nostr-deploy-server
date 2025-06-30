import { nip19, SimplePool } from 'nostr-tools';
import 'websocket-polyfill';
import {
  BlossomServerListEvent,
  NostrEvent,
  ParsedEvent,
  PubkeyResolution,
  RelayListEvent,
  StaticFileEvent,
} from '../types';
import { CacheService } from '../utils/cache';
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
   * Prioritizes relays by reliability for faster responses
   */
  private async getActiveRelays(relays: string[]): Promise<string[]> {
    // Prioritize relays by reliability/speed (Primal, Damus, and Nostr.band are typically faster)
    const priorityRelays = [
      'wss://relay.primal.net',
      'wss://relay.damus.io',
      'wss://relay.nostr.band',
    ];

    const sortedRelays = [
      ...relays.filter((relay) => priorityRelays.includes(relay)),
      ...relays.filter((relay) => !priorityRelays.includes(relay)),
    ];

    const activeRelays: string[] = [];

    // Establish connections to all relays in parallel
    const connectionPromises = sortedRelays.map(async (relay) => {
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
    // Check cache first
    const cached = await CacheService.getRelaysForPubkey(pubkey);
    if (cached) {
      logger.debug(
        `🎯 Relay list cache HIT for pubkey: ${pubkey.substring(0, 8)}... (${cached.length} relays)`
      );
      return cached;
    }

    logger.debug(
      `💔 Relay list cache MISS for pubkey: ${pubkey.substring(0, 8)}... - querying Nostr`
    );

    const config = this.config.getConfig();
    const relays = config.defaultRelays;

    try {
      logger.debug(`Fetching relay list for pubkey: ${pubkey.substring(0, 8)}...`);

      const filter = {
        authors: [pubkey],
        kinds: [10002],
        limit: 1,
      };

      const events = await this.queryRelays(relays, filter, 2000);

      if (events.length === 0) {
        logger.debug(
          `No relay list found for pubkey: ${pubkey.substring(0, 8)}..., using defaults`
        );
        await CacheService.setRelaysForPubkey(pubkey, relays);
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
      await CacheService.setRelaysForPubkey(pubkey, finalRelays);

      logger.logNostr('getRelayList', pubkey, true, { relayCount: finalRelays.length });
      return finalRelays;
    } catch (error) {
      logger.logNostr('getRelayList', pubkey, false, {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      // Return default relays on error
      await CacheService.setRelaysForPubkey(pubkey, relays);
      return relays;
    }
  }

  /**
   * Get Blossom server list for a pubkey (BUD-03)
   */
  public async getBlossomServers(pubkey: string): Promise<string[]> {
    // Check cache first
    const cached = await CacheService.getBlossomServersForPubkey(pubkey);
    if (cached) {
      logger.debug(
        `🎯 Blossom servers cache HIT for pubkey: ${pubkey.substring(0, 8)}... (${
          cached.length
        } servers)`
      );
      return cached;
    }

    logger.debug(
      `💔 Blossom servers cache MISS for pubkey: ${pubkey.substring(0, 8)}... - querying Nostr`
    );

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
        await CacheService.setBlossomServersForPubkey(pubkey, defaultServers);
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
      await CacheService.setBlossomServersForPubkey(pubkey, finalServers);

      logger.logNostr('getBlossomServers', pubkey, true, { serverCount: finalServers.length });
      return finalServers;
    } catch (error) {
      logger.logNostr('getBlossomServers', pubkey, false, {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      // Return default servers on error
      const config = this.config.getConfig();
      const defaultServers = config.defaultBlossomServers;
      await CacheService.setBlossomServersForPubkey(pubkey, defaultServers);
      return defaultServers;
    }
  }

  /**
   * Get static file mapping for a specific path (kind 34128)
   */
  public async getStaticFileMapping(pubkey: string, path: string): Promise<string | null> {
    // Check cache first
    const cached = await CacheService.getBlobForPath(pubkey, path);
    if (cached) {
      logger.debug(
        `🎯 File mapping cache HIT for ${path} from pubkey: ${pubkey.substring(
          0,
          8
        )}... → ${cached.sha256.substring(0, 8)}...`
      );
      return cached.sha256;
    }

    // Check negative cache
    if (await CacheService.isNegativeCached(`mapping:${pubkey}:${path}`)) {
      logger.debug(
        `🚫 Negative cache HIT for ${path} from pubkey: ${pubkey.substring(
          0,
          8
        )}... - returning null`
      );
      return null;
    }

    logger.debug(
      `💔 File mapping cache MISS for ${path} from pubkey: ${pubkey.substring(
        0,
        8
      )}... - querying Nostr`
    );

    const userRelays = await this.getRelayList(pubkey);
    const config = this.config.getConfig();

    try {
      logger.debug(`Fetching file mapping for ${path} from pubkey: ${pubkey.substring(0, 8)}...`);

      const filter = {
        authors: [pubkey],
        kinds: [34128],
        '#d': [path],
        limit: 1,
      };

      // Prepare relay sets for concurrent querying
      const defaultRelays = config.defaultRelays.filter((relay) => !userRelays.includes(relay));
      const allRelaysCombined = [...userRelays, ...defaultRelays];

      // Try user relays first with shorter timeout, then concurrent fallback
      let events = await this.queryRelays(
        userRelays,
        filter,
        Math.min(config.relayQueryTimeoutMs, 2000)
      );

      // If no events found, try both user relays + default relays concurrently with remaining time
      if (events.length === 0 && allRelaysCombined.length > userRelays.length) {
        logger.debug(`No mapping found on user relays, trying all relays concurrently for ${path}`);

        // Use all relays with a slightly longer timeout for the comprehensive search
        events = await this.queryRelays(allRelaysCombined, filter, config.relayQueryTimeoutMs);
      }

      if (events.length === 0) {
        // Try fallback to /404.html if not found
        if (path !== '/404.html') {
          logger.debug(`No mapping found for ${path}, trying /404.html fallback`);
          return this.getStaticFileMapping(pubkey, '/404.html');
        }

        logger.debug(`No file mapping found for ${path} from pubkey: ${pubkey.substring(0, 8)}...`);
        await CacheService.setNegativeCache(`mapping:${pubkey}:${path}`);
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
        await CacheService.setNegativeCache(`mapping:${pubkey}:${path}`);
        return null;
      }

      // Create ParsedEvent for cache
      const parsedEvent: ParsedEvent = {
        pubkey: event.pubkey,
        path: path,
        sha256: sha256,
        created_at: event.created_at,
      };

      await CacheService.setBlobForPath(pubkey, path, parsedEvent);
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
      await CacheService.setNegativeCache(`mapping:${pubkey}:${path}`);
      return null;
    }
  }

  /**
   * Query multiple relays with timeout using persistent connections
   * Optimized for fast responses - terminates early when events are found
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
        resolve(events); // Return what we have so far
      }, timeoutMs);

      let completedRelays = 0;
      let hasFoundEvents = false;
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

            // For file mapping queries (kind 34128), we typically only need one result
            // Terminate early to improve response time
            if (filter.kinds && filter.kinds.includes(34128) && events.length >= 1) {
              if (!hasFoundEvents) {
                hasFoundEvents = true;
                // Give a small grace period for potentially better/newer results
                setTimeout(() => {
                  clearTimeout(timeout);
                  sub.close();
                  resolve(events);
                }, 200); // 200ms grace period
              }
            }
          },
          oneose() {
            completedRelays++;
            if (completedRelays === totalRelays || hasFoundEvents) {
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
    const allRelays = Array.from(this.connections.keys());
    if (allRelays.length > 0) {
      this.closeConnections(allRelays);
    }
    this.connections.clear();

    // Clear the cleanup interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    logger.info('All Nostr connections closed');
  }

  /**
   * Get connection statistics
   */
  public getStats(): {
    activeConnections: number;
    connectedRelays: string[];
  } {
    const connectedRelays: string[] = [];
    let activeConnections = 0;

    for (const [relayUrl, connection] of this.connections.entries()) {
      if (connection.isConnected) {
        connectedRelays.push(relayUrl);
        activeConnections++;
      }
    }

    return {
      activeConnections,
      connectedRelays,
    };
  }
}
