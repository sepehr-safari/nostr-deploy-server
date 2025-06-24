import puppeteer, { Browser, Page } from 'puppeteer';
import { ConfigManager } from '../utils/config';
import { logger } from '../utils/logger';

export interface SimpleSSRResult {
  html: string;
  contentType: string;
  status: number;
}

export class SimpleSSRHelper {
  private config = ConfigManager.getInstance().getConfig();

  /**
   * Render a page using a fresh browser instance (simpler approach)
   */
  async renderPage(
    url: string,
    originalContent: Buffer,
    contentType: string
  ): Promise<SimpleSSRResult> {
    const startTime = Date.now();
    let browser: Browser | null = null;
    let page: Page | null = null;

    try {
      // Check if SSR is enabled
      if (!this.config.ssrEnabled) {
        return {
          html: originalContent.toString(),
          contentType,
          status: 200,
        };
      }

      // Only render HTML files
      if (!contentType.includes('text/html')) {
        return {
          html: originalContent.toString(),
          contentType,
          status: 200,
        };
      }

      logger.debug(`SSR: Starting render for ${url}`);

      // Launch fresh browser for each request (simpler but more reliable)
      browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        timeout: 15000,
      });

      page = await browser.newPage();

      // Set viewport
      await page.setViewport({
        width: this.config.ssrViewportWidth,
        height: this.config.ssrViewportHeight,
      });

      // Set a special user agent to identify SSR requests and prevent recursion
      await page.setUserAgent('NostrSSRBot/1.0 (Internal SSR Request)');

      // Bypass CSP to allow JavaScript execution
      await page.setBypassCSP(true);

      // Add console logging for debugging
      page.on('console', (msg) => {
        logger.debug(`SSR Browser [${msg.type()}]: ${msg.text()}`);
      });

      page.on('pageerror', (error) => {
        logger.warn(`SSR Page error: ${error.message}`);
      });

      // Enable request interception to handle asset loading
      await page.setRequestInterception(true);

      page.on('request', (request) => {
        const requestUrl = request.url();
        logger.debug(`SSR: Request for ${requestUrl}`);

        // Handle relative URLs by redirecting to the actual server
        if (requestUrl.startsWith('/') && !requestUrl.startsWith('//')) {
          const baseUrl = new URL(url);
          const fullUrl = `${baseUrl.protocol}//${baseUrl.host}${requestUrl}`;
          logger.debug(`SSR: Redirecting ${requestUrl} to ${fullUrl}`);
          request.continue({ url: fullUrl });
          return;
        }

        // Allow all other requests
        request.continue();
      });

      page.on('response', (response) => {
        const responseUrl = response.url();
        if (responseUrl.includes('/assets/')) {
          logger.debug(`SSR: Asset response ${response.status()} for ${responseUrl}`);
        }
      });

      // Set timeout
      page.setDefaultTimeout(this.config.ssrTimeoutMs);

      // Instead of setContent, use goto to the actual URL (this works!)
      logger.debug(`SSR: Navigating to ${url}`);

      await page.goto(url, {
        waitUntil: 'networkidle0', // Wait for all network requests to finish
        timeout: 15000,
      });

      // Wait for any JavaScript to execute
      logger.debug('SSR: Waiting for JavaScript execution...');
      await new Promise((resolve) => setTimeout(resolve, 5000)); // Increased wait time

      // Try to wait for root element to be populated
      try {
        await page.waitForFunction(
          `() => {
            const root = document.getElementById('root');
            return root && root.innerHTML.trim().length > 50;
          }`,
          { timeout: 8000 } // Increased timeout
        );
        logger.debug('SSR: Root element populated with content');
      } catch (waitError) {
        logger.warn('SSR: Root element not populated within timeout, checking current state...');

        // Check what's actually in the root element
        const rootContent = await page.evaluate(`
          const root = document.getElementById('root');
          return root ? root.innerHTML : 'ROOT_NOT_FOUND';
        `);
        logger.debug(`SSR: Current root content: "${rootContent}"`);

        // Check for any errors or missing assets
        const hasErrors = await page.evaluate(`
          return window.onerror ? 'Has errors' : 'No errors detected';
        `);
        logger.debug(`SSR: Error status: ${hasErrors}`);
      }

      // Get the rendered HTML
      const renderedHtml = await page.content();

      // Add SSR meta tags
      const enhancedHtml = this.addSSRMetaTags(renderedHtml, url);

      const renderTime = Date.now() - startTime;
      logger.info(`SSR rendered page in ${renderTime}ms for URL: ${url}`);

      return {
        html: enhancedHtml,
        contentType: 'text/html; charset=utf-8',
        status: 200,
      };
    } catch (error) {
      const renderTime = Date.now() - startTime;
      logger.warn(`SSR failed after ${renderTime}ms for URL: ${url}: ${error}`);

      // Fallback to original content
      return {
        html: originalContent.toString(),
        contentType,
        status: 200,
      };
    } finally {
      try {
        if (page) await page.close();
        if (browser) await browser.close();
      } catch (closeError) {
        logger.debug('SSR cleanup error (expected):', closeError);
      }
    }
  }

  /**
   * Add basic SSR meta tags
   */
  private addSSRMetaTags(html: string, url: string): string {
    const metaTags = `
    <meta name="generator" content="Nostr Static Server SSR">
    <meta property="og:url" content="${url}">
    <meta name="twitter:url" content="${url}">
    <link rel="canonical" href="${url}">
  `;

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
  shouldRenderSSR(contentType: string, path: string, userAgent?: string): boolean {
    // Check if SSR is enabled
    if (!this.config.ssrEnabled) {
      return false;
    }

    // Skip SSR for internal SSR requests to prevent recursion
    if (userAgent && userAgent.includes('NostrSSRBot')) {
      return false;
    }

    // Only render HTML files
    if (!contentType.includes('text/html')) {
      return false;
    }

    // Don't render API endpoints or admin paths
    if (path.startsWith('/api/') || path.startsWith('/admin/')) {
      return false;
    }

    return true;
  }

  /**
   * Close any open browser instances
   */
  async close(): Promise<void> {
    // This implementation uses fresh browser instances for each request
    // so there's nothing persistent to close
    logger.debug('SimpleSSRHelper: No persistent browser to close');
  }

  /**
   * Get browser statistics
   */
  async getBrowserStats(): Promise<{
    isConnected: boolean;
    pagesCount: number;
  }> {
    // Since we use fresh browser instances for each request,
    // we don't have persistent browser connections to report on
    return {
      isConnected: false, // No persistent browser connection
      pagesCount: 0, // No persistent pages
    };
  }
}
