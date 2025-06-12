import axios from 'axios';

// Mock all dependencies at the module level
jest.mock('axios');
jest.mock('../../utils/cache', () => ({
  fileContentCache: {
    get: jest.fn(),
    set: jest.fn(),
  },
}));
jest.mock('../../utils/config', () => ({
  ConfigManager: {
    getInstance: jest.fn().mockReturnValue({
      getConfig: jest.fn().mockReturnValue({
        requestTimeoutMs: 30000,
        maxFileSizeMB: 50,
      }),
    }),
  },
}));
jest.mock('../../utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    logBlossom: jest.fn(),
  },
}));

import { BlossomHelper } from '../../helpers/blossom';
import { fileContentCache } from '../../utils/cache';
import { logger } from '../../utils/logger';

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedLogger = logger as jest.Mocked<typeof logger>;

describe('BlossomHelper', () => {
  let blossomHelper: BlossomHelper;
  let mockConfig: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock config
    mockConfig = {
      requestTimeoutMs: 30000,
      maxFileSizeMB: 50,
    };

    const mockConfigInstance = {
      getConfig: jest.fn().mockReturnValue(mockConfig),
    };

    // ConfigManager is already mocked at module level

    blossomHelper = new BlossomHelper();
  });

  describe('MIME type correction', () => {
    beforeEach(() => {
      (fileContentCache.get as jest.Mock).mockReturnValue(null);
    });

    it('should correct CSS file with wrong application/json MIME type', async () => {
      const cssContent = `
        body {
          background-color: #f0f0f0;
          font-family: Arial, sans-serif;
        }
        .header {
          color: #333;
        }
      `;
      const content = new TextEncoder().encode(cssContent);

      mockedAxios.get.mockResolvedValueOnce({
        data: content.buffer,
        headers: {
          'content-type': 'application/json', // Wrong MIME type
        },
        status: 200,
      });

      const result = await blossomHelper.fetchFile(
        'test-sha256',
        ['https://test-server.com'],
        'styles.css'
      );

      expect(result).toBeTruthy();
      expect(result?.contentType).toBe('text/css'); // Should be corrected
      expect(mockedLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          'Correcting incorrect MIME type for styles.css: application/json -> text/css'
        )
      );
    });

    it('should correct JavaScript file with wrong text/plain MIME type', async () => {
      const jsContent = `
        function hello() {
          console.log('Hello World!');
        }
        const x = 10;
        let y = 'test';
      `;
      const content = new TextEncoder().encode(jsContent);

      mockedAxios.get.mockResolvedValueOnce({
        data: content.buffer,
        headers: {
          'content-type': 'text/plain', // Wrong MIME type
        },
        status: 200,
      });

      const result = await blossomHelper.fetchFile(
        'test-sha256',
        ['https://test-server.com'],
        'script.js'
      );

      expect(result).toBeTruthy();
      expect(result?.contentType).toBe('application/javascript'); // Should be corrected
      expect(mockedLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          'Correcting incorrect MIME type for script.js: text/plain -> application/javascript'
        )
      );
    });

    it('should correct HTML file with wrong application/octet-stream MIME type', async () => {
      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Test Page</title>
        </head>
        <body>
          <h1>Hello World</h1>
        </body>
        </html>
      `;
      const content = new TextEncoder().encode(htmlContent);

      mockedAxios.get.mockResolvedValueOnce({
        data: content.buffer,
        headers: {
          'content-type': 'application/octet-stream', // Wrong MIME type
        },
        status: 200,
      });

      const result = await blossomHelper.fetchFile(
        'test-sha256',
        ['https://test-server.com'],
        'index.html'
      );

      expect(result).toBeTruthy();
      expect(result?.contentType).toBe('text/html'); // Should be corrected
    });

    it('should not modify correct MIME types', async () => {
      const cssContent = `
        body { color: red; }
      `;
      const content = new TextEncoder().encode(cssContent);

      mockedAxios.get.mockResolvedValueOnce({
        data: content.buffer,
        headers: {
          'content-type': 'text/css', // Correct MIME type
        },
        status: 200,
      });

      const result = await blossomHelper.fetchFile(
        'test-sha256',
        ['https://test-server.com'],
        'styles.css'
      );

      expect(result).toBeTruthy();
      expect(result?.contentType).toBe('text/css'); // Should remain unchanged
      expect(mockedLogger.warn).not.toHaveBeenCalled();
    });

    it('should not modify MIME types for non-critical file types', async () => {
      const txtContent = 'This is a simple text file.';
      const content = new TextEncoder().encode(txtContent);

      mockedAxios.get.mockResolvedValueOnce({
        data: content.buffer,
        headers: {
          'content-type': 'application/json', // Wrong but for non-critical file
        },
        status: 200,
      });

      const result = await blossomHelper.fetchFile(
        'test-sha256',
        ['https://test-server.com'],
        'readme.txt'
      );

      expect(result).toBeTruthy();
      expect(result?.contentType).toBe('application/json'); // Should not be corrected
      expect(mockedLogger.warn).not.toHaveBeenCalled();
    });

    it('should handle PNG image files correctly', async () => {
      // PNG file signature: 89 50 4E 47
      const pngContent = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

      mockedAxios.get.mockResolvedValueOnce({
        data: pngContent.buffer,
        headers: {
          'content-type': 'application/octet-stream', // Wrong MIME type
        },
        status: 200,
      });

      const result = await blossomHelper.fetchFile(
        'test-sha256',
        ['https://test-server.com'],
        'image.png'
      );

      expect(result).toBeTruthy();
      expect(result?.contentType).toBe('image/png'); // Should be corrected
    });

    it('should handle JSON files correctly', async () => {
      const jsonContent = '{"name": "test", "value": 123}';
      const content = new TextEncoder().encode(jsonContent);

      mockedAxios.get.mockResolvedValueOnce({
        data: content.buffer,
        headers: {
          'content-type': 'text/plain', // Wrong MIME type
        },
        status: 200,
      });

      const result = await blossomHelper.fetchFile(
        'test-sha256',
        ['https://test-server.com'],
        'data.json'
      );

      expect(result).toBeTruthy();
      expect(result?.contentType).toBe('application/json'); // Should be corrected
    });

    it('should not correct MIME type if content validation fails', async () => {
      // Content that doesn't match CSS pattern
      const notCssContent = 'This is just plain text, not CSS';
      const content = new TextEncoder().encode(notCssContent);

      mockedAxios.get.mockResolvedValueOnce({
        data: content.buffer,
        headers: {
          'content-type': 'text/plain', // Wrong MIME type but content doesn't match
        },
        status: 200,
      });

      const result = await blossomHelper.fetchFile(
        'test-sha256',
        ['https://test-server.com'],
        'styles.css'
      );

      expect(result).toBeTruthy();
      expect(result?.contentType).toBe('text/plain'); // Should not be corrected
      expect(mockedLogger.warn).not.toHaveBeenCalled();
    });

    it('should handle files without path extension', async () => {
      const content = new TextEncoder().encode('some content');

      mockedAxios.get.mockResolvedValueOnce({
        data: content.buffer,
        headers: {
          'content-type': 'application/json',
        },
        status: 200,
      });

      const result = await blossomHelper.fetchFile(
        'test-sha256',
        ['https://test-server.com'],
        'file-no-extension'
      );

      expect(result).toBeTruthy();
      expect(result?.contentType).toBe('application/json'); // Should not be modified
    });
  });

  describe('fetchFile error handling', () => {
    it('should handle network errors gracefully', async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error('Network error'));

      const result = await blossomHelper.fetchFile(
        'test-sha256',
        ['https://test-server.com'],
        'test.css'
      );

      expect(result).toBeNull();
      expect(mockedLogger.logBlossom).toHaveBeenCalledWith(
        'fetchFile',
        'test-sha256',
        'https://test-server.com',
        false,
        expect.objectContaining({ error: 'Network error' })
      );
    });
  });
});
