// Test setup file for Jest
import 'websocket-polyfill';

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.PORT = '3001';
process.env.BASE_DOMAIN = 'test.example.com';
process.env.LOG_LEVEL = 'error'; // Reduce log noise in tests
process.env.CACHE_TTL_SECONDS = '60';
process.env.MAX_CACHE_SIZE = '10';

// Mock console methods to reduce test output noise
const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;

console.log = jest.fn();
console.warn = jest.fn();
console.error = jest.fn();

// Restore console methods after each test if needed
afterEach(() => {
  jest.clearAllMocks();
});

// Global test timeout
jest.setTimeout(30000);
