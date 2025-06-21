import { SimpleSSRHelper } from '../../helpers/ssr-simple';
import { ConfigManager } from '../../utils/config';

// Mock dependencies
jest.mock('puppeteer', () => ({
  launch: jest.fn(),
}));

jest.mock('../../utils/config');
jest.mock('../../utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('SimpleSSRHelper', () => {
  let ssrHelper: SimpleSSRHelper;
  let mockBrowser: any;
  let mockPage: any;
  let mockConfigManager: jest.Mocked<ConfigManager>;

  beforeEach(() => {
    // Mock ConfigManager
    mockConfigManager = {
      getConfig: jest.fn().mockReturnValue({
        ssrEnabled: true,
        ssrTimeoutMs: 30000,
        ssrViewportWidth: 1920,
        ssrViewportHeight: 1080,
      }),
    } as any;

    (ConfigManager.getInstance as jest.Mock).mockReturnValue(mockConfigManager);

    // Mock Puppeteer
    mockPage = {
      setViewport: jest.fn().mockResolvedValue(undefined),
      setUserAgent: jest.fn().mockResolvedValue(undefined),
      setBypassCSP: jest.fn().mockResolvedValue(undefined),
      on: jest.fn(),
      setRequestInterception: jest.fn().mockResolvedValue(undefined),
      setDefaultTimeout: jest.fn(),
      goto: jest.fn().mockResolvedValue(undefined),
      waitForFunction: jest.fn().mockResolvedValue(undefined),
      evaluate: jest.fn(),
      content: jest
        .fn()
        .mockResolvedValue('<html><body><div id="root">Rendered Content</div></body></html>'),
      isClosed: jest.fn().mockReturnValue(false),
      close: jest.fn().mockResolvedValue(undefined),
    };

    mockBrowser = {
      newPage: jest.fn().mockResolvedValue(mockPage),
      close: jest.fn().mockResolvedValue(undefined),
    };

    const puppeteer = require('puppeteer');
    puppeteer.launch.mockResolvedValue(mockBrowser);

    ssrHelper = new SimpleSSRHelper();
  });

  afterEach(async () => {
    await ssrHelper.close();
    jest.clearAllMocks();
  });

  describe('shouldRenderSSR', () => {
    it('should return true for HTML content with regular user agent', () => {
      const result = ssrHelper.shouldRenderSSR('text/html', '/', 'Mozilla/5.0');
      expect(result).toBe(true);
    });

    it('should return false for SSR disabled', () => {
      const disabledConfig = {
        port: 3000,
        baseDomain: 'test.com',
        defaultRelays: [],
        defaultBlossomServers: [],
        cacheTtlSeconds: 300,
        maxCacheSize: 100,
        rateLimitWindowMs: 60000,
        rateLimitMaxRequests: 100,
        logLevel: 'info',
        corsOrigin: '*',
        trustProxy: false,
        requestTimeoutMs: 30000,
        maxFileSizeMB: 50,
        ssrEnabled: false,
        ssrTimeoutMs: 30000,
        ssrCacheTtlSeconds: 1800,
        ssrViewportWidth: 1920,
        ssrViewportHeight: 1080,
        ssrMaxConcurrentPages: 3,
        wsConnectionTimeoutMs: 3600000,
        wsCleanupIntervalMs: 300000,
        // Cache TTL Configuration
        negativeCacheTtlMs: 10000,
        positiveCacheTtlMs: 300000,
        fileContentCacheTtlMs: 1800000,
        errorCacheTtlMs: 60000,
        // Query Timeout Configuration
        relayQueryTimeoutMs: 10000,
      };

      mockConfigManager.getConfig.mockReturnValue(disabledConfig);

      // Create a new instance with disabled config
      const disabledSSRHelper = new SimpleSSRHelper();

      const result = disabledSSRHelper.shouldRenderSSR('text/html', '/', 'Mozilla/5.0');
      expect(result).toBe(false);
    });

    it('should return false for NostrSSRBot user agent (prevent recursion)', () => {
      const result = ssrHelper.shouldRenderSSR('text/html', '/', 'NostrSSRBot/1.0');
      expect(result).toBe(false);
    });

    it('should return false for non-HTML content', () => {
      const result = ssrHelper.shouldRenderSSR('application/json', '/', 'Mozilla/5.0');
      expect(result).toBe(false);
    });

    it('should return false for API endpoints', () => {
      const result = ssrHelper.shouldRenderSSR('text/html', '/api/test', 'Mozilla/5.0');
      expect(result).toBe(false);
    });

    it('should return false for admin endpoints', () => {
      const result = ssrHelper.shouldRenderSSR('text/html', '/admin/stats', 'Mozilla/5.0');
      expect(result).toBe(false);
    });
  });

  describe('renderPage', () => {
    const sampleHtml = `
      <!DOCTYPE html>
      <html>
        <head><title>Test</title></head>
        <body><div id="root">Loading...</div></body>
      </html>
    `;

    it('should render page successfully', async () => {
      const result = await ssrHelper.renderPage(
        'http://test.example.com/',
        Buffer.from(sampleHtml),
        'text/html'
      );

      expect(result.html).toContain('Rendered Content');
      expect(result.contentType).toBe('text/html; charset=utf-8');
      expect(result.html).toContain('Nostr Static Server SSR');
      expect(result.html).toContain('og:url');
      expect(result.html).toContain('twitter:url');
      expect(result.html).toContain('canonical');
    });

    it('should add SSR meta tags', async () => {
      const result = await ssrHelper.renderPage(
        'http://test.example.com/',
        Buffer.from(sampleHtml),
        'text/html'
      );

      expect(result.html).toContain('name="generator" content="Nostr Static Server SSR"');
      expect(result.html).toContain('property="og:url" content="http://test.example.com/"');
      expect(result.html).toContain('name="twitter:url" content="http://test.example.com/"');
      expect(result.html).toContain('rel="canonical" href="http://test.example.com/"');
    });

    it('should handle browser errors gracefully', async () => {
      mockBrowser.newPage.mockRejectedValue(new Error('Browser error'));

      const result = await ssrHelper.renderPage(
        'http://test.example.com/',
        Buffer.from(sampleHtml),
        'text/html'
      );

      // Should fallback to original content
      expect(result.html).toContain('Loading...');
      expect(result.contentType).toBe('text/html'); // Original content type without charset
    });

    it('should handle page timeout gracefully', async () => {
      mockPage.goto.mockRejectedValue(new Error('Navigation timeout'));

      const result = await ssrHelper.renderPage(
        'http://test.example.com/',
        Buffer.from(sampleHtml),
        'text/html'
      );

      // Should fallback to original content
      expect(result.html).toContain('Loading...');
    });

    it('should set correct browser configuration', async () => {
      await ssrHelper.renderPage('http://test.example.com/', Buffer.from(sampleHtml), 'text/html');

      expect(mockPage.setViewport).toHaveBeenCalledWith({
        width: 1920,
        height: 1080,
      });
      expect(mockPage.setUserAgent).toHaveBeenCalledWith('NostrSSRBot/1.0 (Internal SSR Request)');
      expect(mockPage.setBypassCSP).toHaveBeenCalledWith(true);
      expect(mockPage.setRequestInterception).toHaveBeenCalledWith(true);
    });
  });

  describe('getBrowserStats', () => {
    it('should return browser statistics', async () => {
      const stats = await ssrHelper.getBrowserStats();

      expect(stats).toHaveProperty('isConnected');
      expect(stats).toHaveProperty('pagesCount');
      expect(typeof stats.isConnected).toBe('boolean');
      expect(typeof stats.pagesCount).toBe('number');
    });
  });

  describe('close', () => {
    it('should close browser gracefully', async () => {
      // Initialize browser first
      await ssrHelper.renderPage(
        'http://test.example.com/',
        Buffer.from('<html></html>'),
        'text/html'
      );

      await ssrHelper.close();

      expect(mockBrowser.close).toHaveBeenCalled();
    });

    it('should handle close errors gracefully', async () => {
      mockBrowser.close.mockRejectedValue(new Error('Close error'));

      // Should not throw
      await expect(ssrHelper.close()).resolves.toBeUndefined();
    });
  });
});
