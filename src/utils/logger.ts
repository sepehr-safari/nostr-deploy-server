import winston from 'winston';
import { ConfigManager } from './config';

class Logger {
  private static instance: Logger;
  private logger: winston.Logger;

  private constructor() {
    const config = ConfigManager.getInstance().getConfig();

    this.logger = winston.createLogger({
      level: config.logLevel,
      format: winston.format.combine(
        winston.format.timestamp({
          format: 'YYYY-MM-DD HH:mm:ss',
        }),
        winston.format.errors({ stack: true }),
        winston.format.colorize(),
        winston.format.printf(({ level, message, timestamp, stack }) => {
          return `${timestamp} [${level}]: ${stack || message}`;
        })
      ),
      transports: [
        new winston.transports.Console({
          handleExceptions: true,
          handleRejections: true,
        }),
      ],
    });

    // Add file transport in production
    if (config.logLevel === 'production') {
      this.logger.add(
        new winston.transports.File({
          filename: 'logs/error.log',
          level: 'error',
          handleExceptions: true,
          handleRejections: true,
          maxsize: 5242880, // 5MB
          maxFiles: 5,
        })
      );

      this.logger.add(
        new winston.transports.File({
          filename: 'logs/combined.log',
          handleExceptions: true,
          handleRejections: true,
          maxsize: 5242880, // 5MB
          maxFiles: 5,
        })
      );
    }
  }

  public static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  public error(message: string, meta?: any): void {
    this.logger.error(message, meta);
  }

  public warn(message: string, meta?: any): void {
    this.logger.warn(message, meta);
  }

  public info(message: string, meta?: any): void {
    this.logger.info(message, meta);
  }

  public debug(message: string, meta?: any): void {
    this.logger.debug(message, meta);
  }

  public verbose(message: string, meta?: any): void {
    this.logger.verbose(message, meta);
  }

  public http(message: string, meta?: any): void {
    this.logger.http(message, meta);
  }

  // Method to log HTTP requests
  public logRequest(
    method: string,
    url: string,
    statusCode: number,
    responseTime: number,
    userAgent?: string
  ): void {
    const message = `${method} ${url} ${statusCode} ${responseTime}ms`;
    const meta = {
      method,
      url,
      statusCode,
      responseTime,
      userAgent,
    };

    if (statusCode >= 400) {
      this.error(message, meta);
    } else {
      this.http(message, meta);
    }
  }

  // Method to log Nostr operations
  public logNostr(operation: string, pubkey: string, success: boolean, details?: any): void {
    const message = `Nostr ${operation} for ${pubkey.substring(0, 8)}... ${
      success ? 'succeeded' : 'failed'
    }`;
    const meta = {
      operation,
      pubkey,
      success,
      ...details,
    };

    if (success) {
      this.info(message, meta);
    } else {
      this.error(message, meta);
    }
  }

  // Method to log Blossom operations
  public logBlossom(
    operation: string,
    sha256: string,
    server: string,
    success: boolean,
    details?: any
  ): void {
    const message = `Blossom ${operation} for ${sha256.substring(0, 8)}... from ${server} ${
      success ? 'succeeded' : 'failed'
    }`;
    const meta = {
      operation,
      sha256,
      server,
      success,
      ...details,
    };

    if (success) {
      this.info(message, meta);
    } else {
      this.error(message, meta);
    }
  }
}

export const logger = Logger.getInstance();
