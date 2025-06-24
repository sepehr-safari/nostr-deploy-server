import * as mimeTypes from 'mime-types';
import puppeteer, { Browser, Page } from 'puppeteer';
import { ConfigManager } from '../utils/config';
import { logger } from '../utils/logger';

export interface SSRResult {
  html: string;
  contentType: string;
  status: number;
}

export interface SSROptions {
  timeout?: number;
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2';
  viewport?: {
    width: number;
    height: number;
  };
  userAgent?: string;
}

export class SSRHelper {
  private browser: Browser | null = null;
  private config = ConfigManager.getInstance().getConfig();
  private activePageCount = 0;

  constructor() {
    this.initializeBrowser();
  }

  private async initializeBrowser(): Promise<void> {
    try {
      logger.info('Initializing Puppeteer browser...');

      this.browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-web-security',
          '--disable-features=site-per-process',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          '--memory-pressure-off',
          '--max_old_space_size=4096',
        ],
        ignoreDefaultArgs: ['--disable-extensions'],
        timeout: 30000,
      });

      logger.info(
        `Puppeteer browser initialized successfully, connected: ${this.browser.isConnected()}`
      );

      // Handle browser disconnect
      this.browser.on('disconnected', () => {
        logger.warn('Puppeteer browser disconnected, will reinitialize on next request');
        this.browser = null;
        // Don't immediately reinitialize - wait for next request to avoid resource waste
      });
    } catch (error) {
      logger.error('Failed to initialize Puppeteer browser:', error);
      throw error;
    }
  }

  private async ensureBrowser(): Promise<Browser> {
    if (!this.browser || !this.browser.isConnected()) {
      await this.initializeBrowser();
    }
    return this.browser!;
  }

  /**
   * Render a static site using Puppeteer
   */
  async renderPage(
    url: string,
    originalContent: Buffer,
    contentType: string,
    options: SSROptions = {}
  ): Promise<SSRResult> {
    const startTime = Date.now();
    let page: Page | null = null;

    try {
      // Check if we've hit the concurrent page limit
      if (this.activePageCount >= this.config.ssrMaxConcurrentPages) {
        logger.warn(
          `SSR: Hit concurrent page limit (${this.config.ssrMaxConcurrentPages}), falling back to original content for ${url}`
        );
        return {
          html: originalContent.toString(),
          contentType,
          status: 200,
        };
      }

      this.activePageCount++;
      logger.debug(
        `SSR: Active pages: ${this.activePageCount}/${this.config.ssrMaxConcurrentPages}`
      );

      const browser = await this.ensureBrowser();
      logger.debug(`SSR: Browser connected: ${browser.isConnected()}`);

      page = await browser.newPage();
      logger.debug(`SSR: New page created for ${url}`);

      // Set viewport
      const viewport = options.viewport || {
        width: this.config.ssrViewportWidth,
        height: this.config.ssrViewportHeight,
      };
      await page.setViewport(viewport);

      // Set user agent if provided
      if (options.userAgent) {
        await page.setUserAgent(options.userAgent);
      }

      // Set timeout
      const timeout = options.timeout || this.config.ssrTimeoutMs;
      page.setDefaultTimeout(timeout);

      // Handle console logs from the page
      page.on('console', (msg) => {
        logger.debug(`Browser console [${msg.type()}]: ${msg.text()}`);
      });

      // Handle page errors
      page.on('pageerror', (error) => {
        logger.warn(`Browser page error: ${error.message}`);
      });

      // Handle console errors
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          logger.warn(`Browser console error: ${msg.text()}`);
        }
      });

      // Disable CSP to allow JavaScript execution during SSR
      await page.setBypassCSP(true);

      // Enable request interception to handle relative asset URLs
      await page.setRequestInterception(true);

      page.on('request', (request) => {
        const requestUrl = request.url();

        // If it's a relative URL starting with /assets or similar, redirect to actual domain
        if (requestUrl.startsWith('data:text/html') || requestUrl.includes('about:blank')) {
          request.continue();
          return;
        }

        // Handle relative asset requests
        if (requestUrl.startsWith('/') && !requestUrl.startsWith('//')) {
          const baseUrl = new URL(url);
          const fullUrl = `${baseUrl.protocol}//${baseUrl.host}${requestUrl}`;
          logger.debug(`SSR: Redirecting asset request from ${requestUrl} to ${fullUrl}`);
          request.continue({ url: fullUrl });
          return;
        }

        request.continue();
      });

      // Handle response interception to fix MIME types
      page.on('response', async (response) => {
        const responseUrl = response.url();
        const originalContentType = response.headers()['content-type'] || '';

        // Only fix MIME types for asset requests (not the main HTML)
        if (
          responseUrl !== url &&
          (responseUrl.includes('/assets/') ||
            responseUrl.match(/\.(css|js|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot)$/i))
        ) {
          const path = new URL(responseUrl).pathname;
          const correctedContentType = this.fixMimeTypeForSSR(originalContentType, path);

          if (correctedContentType !== originalContentType) {
            logger.debug(
              `SSR: Fixed MIME type for ${path}: ${originalContentType} -> ${correctedContentType}`
            );
            // Note: We can't modify response headers in Puppeteer, but this helps with logging
            // The actual fix happens at the server level when serving the assets
          }
        }
      });

      // Check if content is HTML
      if (!contentType.includes('text/html')) {
        // For non-HTML files, return original content
        return {
          html: originalContent.toString(),
          contentType,
          status: 200,
        };
      }

      // Set the HTML content directly
      const htmlContent = originalContent.toString();

      logger.debug(`SSR: Loading page content for ${url}`);
      await page.setContent(htmlContent, {
        waitUntil: options.waitUntil || 'networkidle0',
        timeout,
      });

      // Set the current URL to help with relative asset loading
      await page.evaluate(`window.history.replaceState({}, '', '${url}');`);

      // Wait for the root element to be populated (for SPAs)
      try {
        // Wait for either root div to have content or for a reasonable timeout
        await page.waitForFunction(
          `() => {
            const root = document.getElementById('root');
            return root && (root.children.length > 0 || root.innerHTML.trim().length > 0);
          }`,
          { timeout: timeout / 2 } // Use half the total timeout for this check
        );
        logger.debug('Root element populated, content rendered');
      } catch (waitError) {
        logger.warn('Root element not populated within timeout, proceeding anyway');

        // Additional wait for JavaScript execution
        await new Promise((resolve) => setTimeout(resolve, 3000));

        // Try alternative selectors for common frameworks
        try {
          await page.waitForFunction(
            `() => {
              // Check for common app containers
              const selectors = ['#root', '#app', '[data-reactroot]', '.app'];
              return selectors.some(sel => {
                const el = document.querySelector(sel);
                return el && (el.children.length > 0 || el.innerHTML.trim().length > 20);
              });
            }`,
            { timeout: 5000 }
          );
          logger.debug('App container found with alternative selectors');
        } catch (altError) {
          logger.warn('No app container found, using current page state');
        }
      }

      // Get the rendered HTML
      const renderedHtml = await page.content();

      // Debug: Check if root element has content
      const rootContent = await page.evaluate(`
        const root = document.getElementById('root');
        return root ? root.innerHTML.length : 0;
      `);

      logger.debug(`SSR: Root element content length: ${rootContent} characters`);

      // Inject meta tags for SEO if this is the main page
      const enhancedHtml = this.enhanceHtmlForSSR(renderedHtml, url);

      const renderTime = Date.now() - startTime;
      logger.info(
        `SSR rendered page in ${renderTime}ms for URL: ${url} (root content: ${rootContent} chars)`
      );

      return {
        html: enhancedHtml,
        contentType: 'text/html; charset=utf-8',
        status: 200,
      };
    } catch (error) {
      const renderTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Check if it's a browser disconnection error
      if (
        errorMessage.includes('Protocol error') ||
        errorMessage.includes('Target closed') ||
        errorMessage.includes('Connection closed')
      ) {
        logger.warn(
          `SSR browser disconnected after ${renderTime}ms for URL: ${url}, reinitializing browser`
        );
        // Clear the browser reference so it gets reinitialized on next request
        this.browser = null;
      } else {
        logger.error(`SSR failed after ${renderTime}ms for URL: ${url}`, error);
      }

      // Fallback to original content if SSR fails
      return {
        html: originalContent.toString(),
        contentType,
        status: 200,
      };
    } finally {
      // Always decrement the active page count
      this.activePageCount = Math.max(0, this.activePageCount - 1);

      if (page) {
        try {
          // Check if page is still valid before closing
          if (!page.isClosed()) {
            await page.close();
          }
        } catch (error) {
          // Ignore errors when closing page - browser might have disconnected
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          logger.debug('Page close error (expected if browser disconnected):', errorMessage);
        }
      }
    }
  }

  /**
   * Enhance HTML with SSR-specific optimizations
   */
  private enhanceHtmlForSSR(html: string, url: string): string {
    // Add meta tags for better SEO and social sharing
    const metaTags = `
    <meta name="generator" content="Nostr Static Server SSR">
    <meta property="og:url" content="${url}">
    <meta name="twitter:url" content="${url}">
    <link rel="canonical" href="${url}">
  `;

    // Inject meta tags into head if possible
    if (html.includes('<head>')) {
      return html.replace('<head>', `<head>${metaTags}`);
    } else if (html.includes('<html>')) {
      return html.replace('<html>', `<html><head>${metaTags}</head>`);
    }

    return html;
  }

  /**
   * Check if a file should be SSR rendered
   */
  shouldRenderSSR(contentType: string, path: string): boolean {
    // Check if SSR is enabled in configuration
    if (!this.config.ssrEnabled) {
      return false;
    }

    // Only render HTML files
    if (!contentType.includes('text/html')) {
      return false;
    }

    // Don't render if it's an API endpoint or admin path
    if (path.startsWith('/api/') || path.startsWith('/admin/')) {
      return false;
    }

    return true;
  }

  /**
   * Close the browser and cleanup
   */
  async close(): Promise<void> {
    if (this.browser) {
      try {
        await this.browser.close();
        logger.info('Puppeteer browser closed successfully');
      } catch (error) {
        logger.error('Error closing Puppeteer browser:', error);
      } finally {
        this.browser = null;
      }
    }
  }

  /**
   * Fix incorrect MIME types for assets during SSR
   * Copied from BlossomHelper to handle same MIME type issues
   */
  private fixMimeTypeForSSR(serverContentType: string, path: string): string {
    if (!path) return serverContentType;

    const ext = path.toLowerCase().split('.').pop();
    if (!ext) return serverContentType;

    // Get the expected MIME type based on file extension
    const expectedMimeType = this.getContentTypeFromPath(path);

    // List of correct MIME types for major file types that we want to enforce
    const criticalMimeTypes: Record<string, string[]> = {
      'text/html': ['html', 'htm'],
      'text/css': ['css'],
      'application/javascript': ['js'],
      'text/javascript': ['js'], // Alternative for JavaScript
      'application/json': ['json'],
      'text/xml': ['xml'],
      'application/xml': ['xml'],
      'image/png': ['png'],
      'image/jpeg': ['jpg', 'jpeg'],
      'image/gif': ['gif'],
      'image/svg+xml': ['svg'],
      'image/x-icon': ['ico'],
      'font/woff': ['woff'],
      'font/woff2': ['woff2'],
      'font/ttf': ['ttf'],
      'application/vnd.ms-fontobject': ['eot'],
    };

    // Check if this is a critical file type that we want to fix
    const isCriticalFile = Object.values(criticalMimeTypes).some((extensions) =>
      extensions.includes(ext)
    );

    if (!isCriticalFile) {
      return serverContentType; // Don't modify MIME types for non-critical files
    }

    // List of commonly incorrect MIME types that servers might return
    const incorrectMimeTypes = [
      'application/json',
      'text/plain',
      'application/octet-stream',
      'binary/octet-stream',
      'text/html', // Sometimes HTML is returned for non-HTML files
    ];

    // If server returned an incorrect MIME type for a critical file, fix it
    if (
      incorrectMimeTypes.includes(serverContentType) ||
      !this.isMimeTypeCorrectForExtension(serverContentType, ext)
    ) {
      logger.warn(
        `SSR: Correcting incorrect MIME type for ${path}: ${serverContentType} -> ${expectedMimeType}`
      );
      return expectedMimeType;
    }

    return serverContentType;
  }

  /**
   * Check if the MIME type is correct for the given file extension
   */
  private isMimeTypeCorrectForExtension(mimeType: string, extension: string): boolean {
    const mimeTypeMap: Record<string, string[]> = {
      html: ['text/html'],
      htm: ['text/html'],
      css: ['text/css'],
      js: ['application/javascript', 'text/javascript'],
      json: ['application/json'],
      xml: ['text/xml', 'application/xml'],
      png: ['image/png'],
      jpg: ['image/jpeg'],
      jpeg: ['image/jpeg'],
      gif: ['image/gif'],
      svg: ['image/svg+xml'],
      ico: ['image/x-icon', 'image/vnd.microsoft.icon'],
      woff: ['font/woff', 'application/font-woff'],
      woff2: ['font/woff2', 'application/font-woff2'],
      ttf: ['font/ttf', 'application/font-ttf'],
      eot: ['application/vnd.ms-fontobject'],
    };

    const validMimeTypes = mimeTypeMap[extension.toLowerCase()];
    return validMimeTypes ? validMimeTypes.includes(mimeType.toLowerCase()) : true;
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
      default:
        return 'application/octet-stream';
    }
  }
}
