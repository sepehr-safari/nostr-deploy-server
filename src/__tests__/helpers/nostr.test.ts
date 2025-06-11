import { nip19 } from 'nostr-tools';
import { NostrHelper } from '../../helpers/nostr';
import { blossomServerCache, pathMappingCache, relayListCache } from '../../utils/cache';

// Mock the nostr-tools module
jest.mock('nostr-tools', () => ({
  SimplePool: jest.fn().mockImplementation(() => ({
    subscribeMany: jest.fn(),
    querySync: jest.fn(),
    close: jest.fn(),
  })),
  nip19: {
    decode: jest.fn(),
    encode: jest.fn(),
  },
}));

describe('NostrHelper', () => {
  let nostrHelper: NostrHelper;
  const mockDecode = nip19.decode as jest.MockedFunction<typeof nip19.decode>;

  beforeEach(() => {
    // Clear all caches before each test
    relayListCache.clear();
    blossomServerCache.clear();
    pathMappingCache.clear();

    nostrHelper = new NostrHelper();
    jest.clearAllMocks();
  });

  afterEach(() => {
    nostrHelper.closeAllConnections();
  });

  describe('resolvePubkey', () => {
    it('should resolve valid npub subdomain', () => {
      const testPubkey = '266815e0c9210dfa324c6cba3573b14bee49da4209a9456f9484e5106cd408a5';
      const testNpub = 'npub1yf5pr8xfy58058jxde48x4an905wnfzq28m54mex0pvsdcrxqsrq8ppkzc';

      mockDecode.mockReturnValue({
        type: 'npub',
        data: testPubkey,
      });

      const result = nostrHelper.resolvePubkey(`${testNpub}.test.example.com`);

      expect(result.isValid).toBe(true);
      expect(result.pubkey).toBe(testPubkey);
      expect(result.npub).toBe(testNpub);
      expect(result.subdomain).toBe(testNpub);
    });

    it('should reject invalid npub subdomain', () => {
      mockDecode.mockImplementation(() => {
        throw new Error('Invalid npub');
      });

      const result = nostrHelper.resolvePubkey('invalid-npub.test.example.com');

      expect(result.isValid).toBe(false);
      expect(result.pubkey).toBe('');
    });

    it('should reject non-npub subdomain', () => {
      const result = nostrHelper.resolvePubkey('regular-subdomain.test.example.com');

      expect(result.isValid).toBe(false);
      expect(result.pubkey).toBe('');
      expect(result.subdomain).toBe('regular-subdomain');
    });
  });

  describe('getRelayList', () => {
    it('should return default relays when no relay list event found', async () => {
      // Mock empty result from queryRelays
      const queryRelaysSpy = jest.spyOn(nostrHelper as any, 'queryRelays');
      queryRelaysSpy.mockResolvedValue([]);

      const pubkey = '266815e0c9210dfa324c6cba3573b14bee49da4209a9456f9484e5106cd408a5';
      const relays = await nostrHelper.getRelayList(pubkey);

      expect(relays).toEqual(['wss://nos.lol', 'wss://ditto.pub/relay', 'wss://relay.damus.io']);
    });

    it('should parse relay list from event', async () => {
      const mockEvent = {
        id: 'test-id',
        pubkey: '266815e0c9210dfa324c6cba3573b14bee49da4209a9456f9484e5106cd408a5',
        created_at: Math.floor(Date.now() / 1000),
        kind: 10002,
        tags: [
          ['r', 'wss://custom-relay1.com', 'read'],
          ['r', 'wss://custom-relay2.com'],
          ['r', 'wss://custom-relay3.com', 'write'],
        ],
        content: '',
        sig: 'test-sig',
      };

      const queryRelaysSpy = jest.spyOn(nostrHelper as any, 'queryRelays');
      queryRelaysSpy.mockResolvedValue([mockEvent]);

      const pubkey = '266815e0c9210dfa324c6cba3573b14bee49da4209a9456f9484e5106cd408a5';
      const relays = await nostrHelper.getRelayList(pubkey);

      expect(relays).toEqual(['wss://custom-relay1.com', 'wss://custom-relay2.com']);
    });
  });

  describe('getBlossomServers', () => {
    it('should return default servers when no server list event found', async () => {
      // Mock relay list
      const getRelayListSpy = jest.spyOn(nostrHelper, 'getRelayList');
      getRelayListSpy.mockResolvedValue(['wss://relay.damus.io']);

      // Mock empty result from queryRelays
      const queryRelaysSpy = jest.spyOn(nostrHelper as any, 'queryRelays');
      queryRelaysSpy.mockResolvedValue([]);

      const pubkey = '266815e0c9210dfa324c6cba3573b14bee49da4209a9456f9484e5106cd408a5';
      const servers = await nostrHelper.getBlossomServers(pubkey);

      expect(servers).toEqual(['https://cdn.hzrd149.com', 'https://nostr.download']);
    });

    it('should parse server list from event', async () => {
      const mockEvent = {
        id: 'test-id',
        pubkey: '266815e0c9210dfa324c6cba3573b14bee49da4209a9456f9484e5106cd408a5',
        created_at: Math.floor(Date.now() / 1000),
        kind: 10063,
        tags: [
          ['server', 'https://custom-blossom1.com'],
          ['server', 'https://custom-blossom2.com'],
        ],
        content: '',
        sig: 'test-sig',
      };

      // Mock relay list
      const getRelayListSpy = jest.spyOn(nostrHelper, 'getRelayList');
      getRelayListSpy.mockResolvedValue(['wss://relay.damus.io']);

      // Mock server list result
      const queryRelaysSpy = jest.spyOn(nostrHelper as any, 'queryRelays');
      queryRelaysSpy.mockResolvedValue([mockEvent]);

      const pubkey = '266815e0c9210dfa324c6cba3573b14bee49da4209a9456f9484e5106cd408a5';
      const servers = await nostrHelper.getBlossomServers(pubkey);

      expect(servers).toEqual(['https://custom-blossom1.com', 'https://custom-blossom2.com']);
    });
  });

  describe('getStaticFileMapping', () => {
    it('should return SHA256 hash for valid file mapping', async () => {
      const testSha256 = '186ea5fd14e88fd1ac49351759e7ab906fa94892002b60bf7f5a428f28ca1c99';
      const mockEvent = {
        id: 'test-id',
        pubkey: '266815e0c9210dfa324c6cba3573b14bee49da4209a9456f9484e5106cd408a5',
        created_at: Math.floor(Date.now() / 1000),
        kind: 34128,
        tags: [
          ['d', '/index.html'],
          ['x', testSha256],
        ],
        content: '',
        sig: 'test-sig',
      };

      // Mock relay list
      const getRelayListSpy = jest.spyOn(nostrHelper, 'getRelayList');
      getRelayListSpy.mockResolvedValue(['wss://relay.damus.io']);

      // Mock file mapping result
      const queryRelaysSpy = jest.spyOn(nostrHelper as any, 'queryRelays');
      queryRelaysSpy.mockResolvedValue([mockEvent]);

      const pubkey = '266815e0c9210dfa324c6cba3573b14bee49da4209a9456f9484e5106cd408a5';
      const sha256 = await nostrHelper.getStaticFileMapping(pubkey, '/index.html');

      expect(sha256).toBe(testSha256);
    });

    it('should return null when no file mapping found', async () => {
      // Mock relay list
      const getRelayListSpy = jest.spyOn(nostrHelper, 'getRelayList');
      getRelayListSpy.mockResolvedValue(['wss://relay.damus.io']);

      // Mock empty result
      const queryRelaysSpy = jest.spyOn(nostrHelper as any, 'queryRelays');
      queryRelaysSpy.mockResolvedValue([]);

      const pubkey = '266815e0c9210dfa324c6cba3573b14bee49da4209a9456f9484e5106cd408a5';
      const sha256 = await nostrHelper.getStaticFileMapping(pubkey, '/nonexistent.html');

      expect(sha256).toBeNull();
    });

    it('should fallback to /404.html when file not found', async () => {
      const test404Sha256 = '404hash123';
      const mock404Event = {
        id: 'test-id',
        pubkey: '266815e0c9210dfa324c6cba3573b14bee49da4209a9456f9484e5106cd408a5',
        created_at: Math.floor(Date.now() / 1000),
        kind: 34128,
        tags: [
          ['d', '/404.html'],
          ['x', test404Sha256],
        ],
        content: '',
        sig: 'test-sig',
      };

      // Mock relay list
      const getRelayListSpy = jest.spyOn(nostrHelper, 'getRelayList');
      getRelayListSpy.mockResolvedValue(['wss://relay.damus.io']);

      // Mock query results - first call returns empty, second returns 404 event
      const queryRelaysSpy = jest.spyOn(nostrHelper as any, 'queryRelays');
      queryRelaysSpy
        .mockResolvedValueOnce([]) // First call for /nonexistent.html
        .mockResolvedValueOnce([mock404Event]); // Second call for /404.html

      const pubkey = '266815e0c9210dfa324c6cba3573b14bee49da4209a9456f9484e5106cd408a5';
      const sha256 = await nostrHelper.getStaticFileMapping(pubkey, '/nonexistent.html');

      expect(sha256).toBe(test404Sha256);
    });
  });

  describe('getStats', () => {
    it('should return connection statistics', () => {
      const stats = nostrHelper.getStats();

      expect(stats).toHaveProperty('activeConnections');
      expect(stats).toHaveProperty('connectedRelays');
      expect(typeof stats.activeConnections).toBe('number');
      expect(Array.isArray(stats.connectedRelays)).toBe(true);
    });
  });
});
