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

export class NostrHelper {
  private pool: SimplePool;
  private config: ConfigManager;
  private activeConnections: Set<string> = new Set();

  constructor() {
    this.pool = new SimplePool();
    this.config = ConfigManager.getInstance();
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

      const events = await this.queryRelays(userRelays, filter, 5000);

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

      const events = await this.queryRelays(userRelays, filter, 5000);

      if (events.length === 0) {
        // Try fallback to /404.html if not found
        if (path !== '/404.html') {
          logger.debug(`No mapping found for ${path}, trying /404.html fallback`);
          return this.getStaticFileMapping(pubkey, '/404.html');
        }

        logger.debug(`No file mapping found for ${path} from pubkey: ${pubkey.substring(0, 8)}...`);
        pathMappingCache.set(cacheKey, '', 60000); // Cache negative result for 1 minute
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
        pathMappingCache.set(cacheKey, '', 60000); // Cache negative result for 1 minute
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
      pathMappingCache.set(cacheKey, '', 60000); // Cache negative result for 1 minute
      return null;
    }
  }

  /**
   * Query multiple relays with timeout
   */
  private async queryRelays(
    relays: string[],
    filter: any,
    timeoutMs: number = 10000
  ): Promise<NostrEvent[]> {
    return new Promise((resolve, reject) => {
      const events: NostrEvent[] = [];
      const timeout = setTimeout(() => {
        this.closeConnections(relays);
        resolve(events); // Return what we have so far instead of rejecting
      }, timeoutMs);

      let completedRelays = 0;
      const totalRelays = relays.length;

      if (totalRelays === 0) {
        clearTimeout(timeout);
        resolve(events);
        return;
      }

      relays.forEach((relay) => {
        try {
          const sub = this.pool.subscribeMany([relay], [filter], {
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

          // Track active connections
          this.activeConnections.add(relay);
        } catch (error) {
          logger.error(`Error connecting to relay ${relay}:`, error);
          completedRelays++;
          if (completedRelays === totalRelays) {
            clearTimeout(timeout);
            resolve(events);
          }
        }
      });
    });
  }

  /**
   * Close connections to specific relays
   */
  private closeConnections(relays: string[]): void {
    try {
      this.pool.close(relays);
      relays.forEach((relay) => this.activeConnections.delete(relay));
    } catch (error) {
      logger.error('Error closing relay connections:', error);
    }
  }

  /**
   * Close all connections
   */
  public closeAllConnections(): void {
    try {
      const allRelays = Array.from(this.activeConnections);
      this.pool.close(allRelays);
      this.activeConnections.clear();
      logger.info('All Nostr relay connections closed');
    } catch (error) {
      logger.error('Error closing all relay connections:', error);
    }
  }

  /**
   * Get connection statistics
   */
  public getStats(): { activeConnections: number; connectedRelays: string[] } {
    return {
      activeConnections: this.activeConnections.size,
      connectedRelays: Array.from(this.activeConnections),
    };
  }
}
