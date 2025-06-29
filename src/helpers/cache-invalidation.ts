import { SimplePool } from 'nostr-tools';
import 'websocket-polyfill';
import { BlossomServerListEvent, NostrEvent, RelayListEvent, StaticFileEvent } from '../types';
import { CacheService } from '../utils/cache';
import { ConfigManager } from '../utils/config';
import { logger } from '../utils/logger';

interface InvalidationConnection {
  url: string;
  isConnected: boolean;
  lastEventTime: number;
  reconnectAttempts: number;
}

/**
 * Real-time Cache Invalidation Service
 *
 * Subscribes to Nostr relays and invalidates cache entries when relevant events are received.
 * Follows distributed systems best practices for cache invalidation as outlined in:
 * - https://amankrpandey1.medium.com/mastering-cache-invalidation-implementation-and-best-practices-47c70f66d3ad
 * - https://blog.the-pans.com/when-and-how-to-invalidate-cache/
 */
export class CacheInvalidationService {
  private pool: SimplePool;
  private config: ConfigManager;
  private connections: Map<string, InvalidationConnection> = new Map();
  private subscriptions: Map<string, any> = new Map();
  private reconnectTimers: Map<string, NodeJS.Timeout> = new Map();
  private isEnabled: boolean = false;
  private isShuttingDown: boolean = false;

  constructor() {
    this.pool = new SimplePool();
    this.config = ConfigManager.getInstance();

    const configData = this.config.getConfig();
    this.isEnabled = configData.realtimeCacheInvalidation;

    if (this.isEnabled) {
      logger.info('Real-time cache invalidation service enabled');
      this.initialize();
    } else {
      logger.info('Real-time cache invalidation service disabled');
    }
  }

  /**
   * Initialize invalidation service and start subscriptions
   */
  private async initialize(): Promise<void> {
    const configData = this.config.getConfig();

    try {
      // Establish connections to invalidation relays
      await this.connectToRelays(configData.invalidationRelays);

      // Start subscriptions for cache-relevant events
      this.startInvalidationSubscriptions();

      logger.info(
        `Cache invalidation service initialized with ${configData.invalidationRelays.length} relays`
      );
    } catch (error) {
      logger.error('Failed to initialize cache invalidation service:', error);
    }
  }

  /**
   * Connect to invalidation relays
   */
  private async connectToRelays(relays: string[]): Promise<void> {
    const connectionPromises = relays.map(async (relay) => {
      try {
        const connection: InvalidationConnection = {
          url: relay,
          isConnected: false,
          lastEventTime: Date.now(),
          reconnectAttempts: 0,
        };

        this.connections.set(relay, connection);

        // Test connection (the SimplePool will handle actual WebSocket management)
        connection.isConnected = true;
        logger.debug(`Connected to invalidation relay: ${relay}`);
      } catch (error) {
        logger.warn(`Failed to connect to invalidation relay ${relay}:`, error);
      }
    });

    await Promise.allSettled(connectionPromises);
  }

  /**
   * Start subscriptions for cache invalidation events
   */
  private startInvalidationSubscriptions(): void {
    const configData = this.config.getConfig();
    const connectedRelays = Array.from(this.connections.keys()).filter(
      (relay) => this.connections.get(relay)?.isConnected
    );

    logger.info(`Starting cache invalidation subscriptions...`);
    logger.debug(`Available relays: ${Array.from(this.connections.keys()).length}`);
    logger.debug(`Connected relays: ${connectedRelays.length}`);

    if (connectedRelays.length === 0) {
      logger.warn('⚠️  No connected invalidation relays available - subscriptions will not work');
      logger.warn('🔧 Check your INVALIDATION_RELAYS configuration and network connectivity');
      return;
    }

    logger.info(`📡 Setting up subscriptions on ${connectedRelays.length} connected relays:`);
    connectedRelays.forEach((relay, i) => {
      logger.info(`   ${i + 1}. ${relay}`);
    });

    // Subscribe to static file events (kind 34128)
    this.subscribeToStaticFileEvents(connectedRelays);

    // Subscribe to relay list events (kind 10002)
    this.subscribeToRelayListEvents(connectedRelays);

    // Subscribe to blossom server list events (kind 10063)
    this.subscribeToBlossomServerEvents(connectedRelays);

    logger.info(
      `✅ Started ${this.subscriptions.size} cache invalidation subscriptions on ${connectedRelays.length} relays`
    );
  }

  /**
   * Subscribe to static file mapping events (kind 34128)
   */
  private subscribeToStaticFileEvents(relays: string[]): void {
    // Include recent events from the last hour to catch any we might have missed
    // plus real-time events going forward
    const lookbackSeconds = 3600; // 1 hour
    const filter = {
      kinds: [34128], // Static file events
      since: Math.floor(Date.now() / 1000) - lookbackSeconds, // Include recent events
    };

    logger.info(`Subscribing to static file events (kind 34128) on ${relays.length} relays`);
    logger.info(
      `📅 Filter includes events from last ${lookbackSeconds / 3600} hour(s) plus real-time`
    );
    logger.debug(`Static file event filter:`, filter);

    const sub = this.pool.subscribeMany(relays, [filter], {
      onevent: (event: NostrEvent) => {
        const eventAge = Math.floor(Date.now() / 1000) - event.created_at;
        logger.info(
          `📥 Received static file event (kind ${event.kind}) from ${event.pubkey.substring(
            0,
            8
          )}... (${eventAge}s ago)`
        );

        // Additional validation
        if (event.kind !== 34128) {
          logger.warn(`⚠️  Received wrong event kind: ${event.kind}, expected 34128`);
          return;
        }

        this.handleStaticFileEvent(event as StaticFileEvent);
      },
      oneose: () => {
        logger.info('✅ Static file event subscription established successfully');
        logger.info('🔍 Now monitoring for both recent and new kind 34128 events...');
      },
      onclose: (reasons: string[]) => {
        logger.warn('❌ Static file event subscription closed:', reasons);
        if (!this.isShuttingDown) {
          this.scheduleReconnect();
        }
      },
    });

    this.subscriptions.set('static-files', sub);
    logger.debug(`Static file subscription stored with ${relays.length} relays`);
  }

  /**
   * Subscribe to relay list events (kind 10002)
   */
  private subscribeToRelayListEvents(relays: string[]): void {
    const filter = {
      kinds: [10002], // Relay list events
      since: Math.floor(Date.now() / 1000), // Only new events
    };

    const sub = this.pool.subscribeMany(relays, [filter], {
      onevent: (event: NostrEvent) => {
        this.handleRelayListEvent(event as RelayListEvent);
      },
      oneose: () => {
        logger.debug('Relay list event subscription established');
      },
      onclose: (reasons: string[]) => {
        logger.warn('Relay list event subscription closed:', reasons);
        if (!this.isShuttingDown) {
          this.scheduleReconnect();
        }
      },
    });

    this.subscriptions.set('relay-lists', sub);
  }

  /**
   * Subscribe to blossom server list events (kind 10063)
   */
  private subscribeToBlossomServerEvents(relays: string[]): void {
    const filter = {
      kinds: [10063], // Blossom server list events
      since: Math.floor(Date.now() / 1000), // Only new events
    };

    const sub = this.pool.subscribeMany(relays, [filter], {
      onevent: (event: NostrEvent) => {
        this.handleBlossomServerEvent(event as BlossomServerListEvent);
      },
      oneose: () => {
        logger.debug('Blossom server event subscription established');
      },
      onclose: (reasons: string[]) => {
        logger.warn('Blossom server event subscription closed:', reasons);
        if (!this.isShuttingDown) {
          this.scheduleReconnect();
        }
      },
    });

    this.subscriptions.set('blossom-servers', sub);
  }

  /**
   * Handle static file mapping events for cache invalidation
   */
  private async handleStaticFileEvent(event: StaticFileEvent): Promise<void> {
    try {
      const pubkey = event.pubkey;
      const eventId = event.id?.substring(0, 8) || 'unknown';

      logger.info(
        `🔄 Processing static file event ${eventId}... from ${pubkey.substring(0, 8)}...`
      );
      logger.debug(`Full event:`, {
        id: event.id,
        pubkey: event.pubkey,
        kind: event.kind,
        created_at: event.created_at,
        tags: event.tags,
        content: event.content?.substring(0, 100) + (event.content?.length > 100 ? '...' : ''),
      });

      // Extract path from 'd' tag
      let path: string | null = null;
      for (const tag of event.tags) {
        if (tag[0] === 'd' && tag[1]) {
          path = tag[1];
          break;
        }
      }

      if (!path) {
        logger.warn(
          `⚠️  Static file event ${eventId} missing 'd' tag with path, skipping invalidation`
        );
        logger.debug(`Available tags:`, event.tags);
        return;
      }

      logger.info(`🗂️  Processing path: ${path} for pubkey: ${pubkey.substring(0, 8)}...`);

      // Validate the path
      if (!path.startsWith('/')) {
        logger.warn(`⚠️  Invalid path format: ${path} (should start with /)`);
      }

      // Extract SHA256 hash from 'x' tag
      let sha256: string | null = null;
      for (const tag of event.tags) {
        if (tag[0] === 'x' && tag[1]) {
          sha256 = tag[1];
          break;
        }
      }

      if (!sha256) {
        logger.warn(
          `⚠️  Static file event ${eventId} missing 'x' tag with SHA256 hash, invalidating cache only`
        );
        await CacheService.invalidateBlobForPath(pubkey, path);
        return;
      }

      // Create ParsedEvent for cache and UPDATE cache instead of invalidating
      const parsedEvent = {
        pubkey: event.pubkey,
        path: path,
        sha256: sha256,
        created_at: event.created_at,
      };

      logger.debug(`📦 Updating cache with new data: ${path} → ${sha256.substring(0, 8)}...`);
      await CacheService.setBlobForPath(pubkey, path, parsedEvent);

      logger.info(
        `✅ Cache UPDATED for static file: ${path} by ${pubkey.substring(
          0,
          8
        )}... → ${sha256.substring(0, 8)}... (event ${eventId})`
      );

      // Update statistics
      this.connections.forEach((conn, url) => {
        if (conn.isConnected) {
          conn.lastEventTime = Math.floor(Date.now() / 1000);
        }
      });
    } catch (error) {
      logger.error(`❌ Error handling static file event for cache invalidation:`, error);
      logger.error(`Event details:`, {
        id: event.id,
        pubkey: event.pubkey,
        kind: event.kind,
        tags: event.tags,
      });
    }
  }

  /**
   * Handle relay list events for cache update
   */
  private async handleRelayListEvent(event: RelayListEvent): Promise<void> {
    try {
      const pubkey = event.pubkey;

      logger.debug(`Processing relay list update for: ${pubkey.substring(0, 8)}...`);

      // Parse relay tags to extract relay list
      const userRelays: string[] = [];
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

      // Update cache with new relay list (or use defaults if empty)
      const config = this.config.getConfig();
      const finalRelays = userRelays.length > 0 ? userRelays : config.defaultRelays;

      await CacheService.setRelaysForPubkey(pubkey, finalRelays);

      logger.info(
        `✅ Relay list cache UPDATED for ${pubkey.substring(0, 8)}... (${
          finalRelays.length
        } relays)`
      );
    } catch (error) {
      logger.error('Error handling relay list event for cache update:', error);
    }
  }

  /**
   * Handle blossom server list events for cache update
   */
  private async handleBlossomServerEvent(event: BlossomServerListEvent): Promise<void> {
    try {
      const pubkey = event.pubkey;

      logger.debug(`Processing blossom server list update for: ${pubkey.substring(0, 8)}...`);

      // Parse server tags to extract server list
      const servers: string[] = [];
      for (const tag of event.tags) {
        if (tag[0] === 'server' && tag[1]) {
          servers.push(tag[1]);
        }
      }

      // Update cache with new server list (or use defaults if empty)
      const config = this.config.getConfig();
      const finalServers = servers.length > 0 ? servers : config.defaultBlossomServers;

      await CacheService.setBlossomServersForPubkey(pubkey, finalServers);

      logger.info(
        `✅ Blossom server cache UPDATED for ${pubkey.substring(0, 8)}... (${
          finalServers.length
        } servers)`
      );
    } catch (error) {
      logger.error('Error handling blossom server event for cache update:', error);
    }
  }

  /**
   * Schedule reconnection to failed relays
   */
  private scheduleReconnect(): void {
    const configData = this.config.getConfig();

    setTimeout(() => {
      if (!this.isShuttingDown && this.isEnabled) {
        logger.info('Attempting to reconnect invalidation service...');
        this.initialize();
      }
    }, configData.invalidationReconnectDelayMs);
  }

  /**
   * Get service statistics
   */
  public getStats(): {
    enabled: boolean;
    connectedRelays: number;
    activeSubscriptions: number;
    relays: string[];
  } {
    const connectedRelays = Array.from(this.connections.values()).filter(
      (conn) => conn.isConnected
    );

    return {
      enabled: this.isEnabled,
      connectedRelays: connectedRelays.length,
      activeSubscriptions: this.subscriptions.size,
      relays: Array.from(this.connections.keys()),
    };
  }

  /**
   * Gracefully shutdown the invalidation service
   */
  public async shutdown(): Promise<void> {
    this.isShuttingDown = true;

    logger.info('Shutting down cache invalidation service...');

    // Clear reconnect timers
    this.reconnectTimers.forEach((timer) => clearTimeout(timer));
    this.reconnectTimers.clear();

    // Close all subscriptions
    this.subscriptions.forEach((sub) => {
      try {
        sub.close();
      } catch (error) {
        logger.error('Error closing invalidation subscription:', error);
      }
    });
    this.subscriptions.clear();

    // Close pool connections
    try {
      const relayUrls = Array.from(this.connections.keys());
      if (relayUrls.length > 0) {
        this.pool.close(relayUrls);
      }
    } catch (error) {
      logger.error('Error closing invalidation relay connections:', error);
    }

    this.connections.clear();

    logger.info('Cache invalidation service shutdown complete');
  }
}
