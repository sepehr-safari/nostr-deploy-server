import cors from 'cors';
import express, { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { BlossomHelper } from './helpers/blossom';
import { NostrHelper } from './helpers/nostr';
import { SimpleSSRHelper } from './helpers/ssr-simple';
import { ConfigManager } from './utils/config';
import { logger } from './utils/logger';

// Initialize components
const configManager = ConfigManager.getInstance();
const config = configManager.getConfig();
const nostrHelper = new NostrHelper();
const blossomHelper = new BlossomHelper();
const ssrHelper = new SimpleSSRHelper();

// Create Express app
const app = express();

// Security middleware
app.use(
  helmet({
    contentSecurityPolicy: false, // Allow inline scripts for static sites
    crossOriginEmbedderPolicy: false, // Allow embedding
    frameguard: false, // Allow embedding in iframes
  })
);

// CORS configuration
app.use(
  cors({
    origin: config.corsOrigin,
    credentials: true,
  })
);

// Trust proxy if configured
if (config.trustProxy) {
  app.set('trust proxy', 1);
}

// Request logging middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const userAgent = req.get('User-Agent') || '';
    logger.logRequest(req.method, req.url, res.statusCode, duration, userAgent);
  });

  next();
});

// Rate limiting middleware (simple in-memory implementation)
const requestCounts = new Map<string, { count: number; resetTime: number }>();

app.use((req: Request, res: Response, next: NextFunction) => {
  const clientIp = req.ip || req.connection.remoteAddress || 'unknown';
  const now = Date.now();
  const windowMs = config.rateLimitWindowMs;
  const maxRequests = config.rateLimitMaxRequests;

  // Clean up old entries
  for (const [ip, data] of requestCounts.entries()) {
    if (now > data.resetTime) {
      requestCounts.delete(ip);
    }
  }

  // Get or create entry for this IP
  let entry = requestCounts.get(clientIp);
  if (!entry || now > entry.resetTime) {
    entry = { count: 0, resetTime: now + windowMs };
    requestCounts.set(clientIp, entry);
  }

  // Check rate limit
  if (entry.count >= maxRequests) {
    logger.warn(`Rate limit exceeded for IP: ${clientIp}`);
    res.status(429).json({
      error: 'Too Many Requests',
      message: 'Rate limit exceeded. Please try again later.',
      retryAfter: Math.ceil((entry.resetTime - now) / 1000),
    });
    return;
  }

  entry.count++;
  next();
});

// Landing page for main domain
app.get('*', async (req: Request, res: Response) => {
  const hostname = req.hostname;
  const requestPath = req.path;

  try {
    // Check if this is the main domain (not a subdomain)
    const configData = config;
    const baseDomain = configData.baseDomain;

    if (hostname === baseDomain || hostname === `www.${baseDomain}`) {
      // Serve landing page for main domain
      const landingPageHTML = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>NostrDeploy - Decentralized Static Site Hosting</title>
    <meta name="description" content="Deploy and host static websites using the Nostr protocol and Blossom servers. Decentralized, censorship-resistant, and zero-storage hosting.">
    <link rel="canonical" href="https://${baseDomain}">
    
    <!-- Open Graph / Facebook -->
    <meta property="og:type" content="website">
    <meta property="og:url" content="https://${baseDomain}">
    <meta property="og:title" content="NostrDeploy - Decentralized Static Site Hosting">
    <meta property="og:description" content="Deploy and host static websites using the Nostr protocol and Blossom servers. Decentralized, censorship-resistant, and zero-storage hosting.">
    
    <!-- Twitter -->
    <meta property="twitter:card" content="summary_large_image">
    <meta property="twitter:url" content="https://${baseDomain}">
    <meta property="twitter:title" content="NostrDeploy - Decentralized Static Site Hosting">
    <meta property="twitter:description" content="Deploy and host static websites using the Nostr protocol and Blossom servers. Decentralized, censorship-resistant, and zero-storage hosting.">
    
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        :root {
            --primary: #8b5cf6;
            --primary-dark: #7c3aed;
            --secondary: #06b6d4;
            --bg-dark: #0f172a;
            --bg-card: #1e293b;
            --text-primary: #f8fafc;
            --text-secondary: #cbd5e1;
            --border: #334155;
            --success: #10b981;
            --warning: #f59e0b;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: linear-gradient(135deg, var(--bg-dark) 0%, #1e1b4b 100%);
            color: var(--text-primary);
            line-height: 1.6;
            min-height: 100vh;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 0 1rem;
        }
        
        /* Header */
        header {
            padding: 1rem 0;
            border-bottom: 1px solid var(--border);
            backdrop-filter: blur(10px);
            position: sticky;
            top: 0;
            z-index: 100;
        }
        
        nav {
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .logo {
            font-size: 1.5rem;
            font-weight: bold;
            background: linear-gradient(45deg, var(--primary), var(--secondary));
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }
        
        .nav-links {
            display: flex;
            gap: 2rem;
            list-style: none;
        }
        
        .nav-links a {
            color: var(--text-secondary);
            text-decoration: none;
            transition: color 0.3s;
        }
        
        .nav-links a:hover {
            color: var(--text-primary);
        }
        
        /* Hero Section */
        .hero {
            padding: 4rem 0;
            text-align: center;
            background: radial-gradient(circle at center, rgba(139, 92, 246, 0.1) 0%, transparent 70%);
        }
        
        .hero h1 {
            font-size: 3.5rem;
            font-weight: 800;
            margin-bottom: 1rem;
            background: linear-gradient(45deg, var(--primary), var(--secondary));
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }
        
        .hero .subtitle {
            font-size: 1.25rem;
            color: var(--text-secondary);
            margin-bottom: 2rem;
            max-width: 600px;
            margin-left: auto;
            margin-right: auto;
        }
        
        .cta-buttons {
            display: flex;
            gap: 1rem;
            justify-content: center;
            flex-wrap: wrap;
            margin-bottom: 3rem;
        }
        
        .btn {
            padding: 0.75rem 2rem;
            border-radius: 0.5rem;
            text-decoration: none;
            font-weight: 600;
            transition: all 0.3s;
            border: none;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
        }
        
        .btn-primary {
            background: linear-gradient(45deg, var(--primary), var(--primary-dark));
            color: white;
        }
        
        .btn-primary:hover {
            transform: translateY(-2px);
            box-shadow: 0 10px 25px rgba(139, 92, 246, 0.3);
        }
        
        .btn-secondary {
            background: transparent;
            color: var(--text-primary);
            border: 2px solid var(--border);
        }
        
        .btn-secondary:hover {
            border-color: var(--primary);
            color: var(--primary);
        }
        
        
        
        /* Features */
        .features {
            padding: 4rem 0;
        }
        
        .section-title {
            text-align: center;
            font-size: 2.5rem;
            font-weight: bold;
            margin-bottom: 3rem;
        }
        
        .features-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 2rem;
        }
        
        .feature-card {
            background: var(--bg-card);
            padding: 2rem;
            border-radius: 1rem;
            border: 1px solid var(--border);
            transition: transform 0.3s, border-color 0.3s;
        }
        
        .feature-card:hover {
            transform: translateY(-5px);
            border-color: var(--primary);
        }
        
        .feature-icon {
            width: 3rem;
            height: 3rem;
            background: linear-gradient(45deg, var(--primary), var(--secondary));
            border-radius: 0.75rem;
            display: flex;
            align-items: center;
            justify-content: center;
            margin-bottom: 1rem;
            font-size: 1.5rem;
        }
        
        .feature-title {
            font-size: 1.25rem;
            font-weight: bold;
            margin-bottom: 0.5rem;
        }
        
        .feature-description {
            color: var(--text-secondary);
        }
        
        /* How it works */
        .how-it-works {
            padding: 4rem 0;
            background: rgba(30, 41, 59, 0.3);
        }
        
        .steps {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 2rem;
        }
        
        .step {
            text-align: center;
            position: relative;
        }
        
        .step-number {
            width: 3rem;
            height: 3rem;
            background: linear-gradient(45deg, var(--primary), var(--secondary));
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
            margin: 0 auto 1rem;
        }
        
        .step-title {
            font-size: 1.25rem;
            font-weight: bold;
            margin-bottom: 0.5rem;
        }
        
        .step-description {
            color: var(--text-secondary);
        }
        
        /* Example */
        .example {
            padding: 4rem 0;
        }
        
        .code-block {
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: 0.5rem;
            padding: 1.5rem;
            font-family: 'Courier New', monospace;
            font-size: 0.9rem;
            overflow-x: auto;
            margin: 1rem 0;
        }
        
        .subdomain-example {
            color: var(--secondary);
            font-weight: bold;
        }
        
        /* Footer */
        footer {
            background: var(--bg-card);
            padding: 3rem 0 2rem;
            border-top: 1px solid var(--border);
            margin-top: 4rem;
        }
        
        .footer-content {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 2rem;
            margin-bottom: 2rem;
        }
        
        .footer-section h3 {
            color: var(--text-primary);
            margin-bottom: 1rem;
        }
        
        .footer-section a {
            color: var(--text-secondary);
            text-decoration: none;
            display: block;
            margin-bottom: 0.5rem;
            transition: color 0.3s;
        }
        
        .footer-section a:hover {
            color: var(--primary);
        }
        
        .footer-bottom {
            text-align: center;
            padding-top: 2rem;
            border-top: 1px solid var(--border);
            color: var(--text-secondary);
        }
        
        /* Responsive */
        @media (max-width: 768px) {
            .hero h1 {
                font-size: 2.5rem;
            }
            
            .cta-buttons {
                flex-direction: column;
                align-items: center;
            }
            
            .btn {
                width: 200px;
                justify-content: center;
            }
            
            .nav-links {
                display: none;
            }
        }
        
        /* Animations */
        @keyframes float {
            0%, 100% { transform: translateY(0px); }
            50% { transform: translateY(-10px); }
        }
        
        .floating {
            animation: float 3s ease-in-out infinite;
        }
        
        
    </style>
</head>
<body>
    <header>
        <nav class="container">
            <div class="logo">🚀 NostrDeploy</div>
                         <ul class="nav-links">
                <li><a href="#features">Features</a></li>
                <li><a href="#how-it-works">How It Works</a></li>
                <li><a href="#example">Example</a></li>
                <li><a href="https://github.com/nostr-protocol/nips/" target="_blank">NIPs</a></li>
            </ul>
        </nav>
    </header>

    <main>
        <section class="hero">
            <div class="container">
                <h1 class="floating">NostrDeploy</h1>
                <p class="subtitle">
                    Deploy and host static websites using the Nostr protocol and Blossom servers. 
                    Decentralized, censorship-resistant, and zero-storage hosting.
                </p>
                <div class="cta-buttons">
                    <a href="https://nostrhub.io/naddr1qvzqqqrcvypzqfngzhsvjggdlgeycm96x4emzjlwf8dyyzdfg4hefp89zpkdgz99qqt8qatzddjhjttnw3shg6tr94mk2cnnd96x2uch7k70g" class="btn btn-primary" target="_blank">
                        📖 View NIP Specification
                    </a>
                    <a href="https://github.com/sepehr-safari/nostr-deploy-cli" class="btn btn-secondary" target="_blank">
                        🚀 Deploy CLI Tool
                    </a>
                </div>
            </div>
        </section>

        <section id="features" class="features">
            <div class="container">
                <h2 class="section-title">Why NostrDeploy?</h2>
                <div class="features-grid">
                    <div class="feature-card">
                        <div class="feature-icon">🌐</div>
                        <h3 class="feature-title">Decentralized Hosting</h3>
                        <p class="feature-description">
                            Your website files are stored on Blossom servers and indexed via Nostr events. 
                            No single point of failure or censorship.
                        </p>
                    </div>
                    <div class="feature-card">
                        <div class="feature-icon">🔒</div>
                        <h3 class="feature-title">Cryptographic Security</h3>
                        <p class="feature-description">
                            All file mappings are cryptographically signed with your Nostr private key. 
                            Only you can update your site.
                        </p>
                    </div>
                    <div class="feature-card">
                        <div class="feature-icon">💾</div>
                        <h3 class="feature-title">Zero Local Storage</h3>
                        <p class="feature-description">
                            This server acts as a pure gateway - no files are stored locally. 
                            Everything is retrieved from the decentralized network.
                        </p>
                    </div>
                    <div class="feature-card">
                        <div class="feature-icon">⚡</div>
                        <h3 class="feature-title">Intelligent Caching</h3>
                        <p class="feature-description">
                            Smart in-memory caching with TTL ensures fast loading times while 
                            maintaining data freshness.
                        </p>
                    </div>
                    <div class="feature-card">
                        <div class="feature-icon">🔗</div>
                        <h3 class="feature-title">Npub Subdomains</h3>
                        <p class="feature-description">
                            Access any site using npub subdomains: npub1xyz.nostrdeploy.com
                            Clean, memorable URLs for the decentralized web.
                        </p>
                    </div>
                    <div class="feature-card">
                        <div class="feature-icon">🛡️</div>
                        <h3 class="feature-title">Built-in Protection</h3>
                        <p class="feature-description">
                            Rate limiting, security headers, graceful error handling, 
                            and automatic fallbacks keep your sites running smoothly.
                        </p>
                    </div>
                </div>
            </div>
        </section>

        <section id="how-it-works" class="how-it-works">
            <div class="container">
                <h2 class="section-title">How It Works</h2>
                <div class="steps">
                    <div class="step">
                        <div class="step-number">1</div>
                        <h3 class="step-title">Publish Files</h3>
                        <p class="step-description">
                            Upload your static site files to Blossom servers and publish 
                            path mappings as Nostr events (kind 34128). Use our 
                            <a href="https://github.com/sepehr-safari/nostr-deploy-cli" target="_blank" style="color: var(--secondary);">CLI tool</a> 
                            for easy deployment.
                        </p>
                    </div>
                    <div class="step">
                        <div class="step-number">2</div>
                        <h3 class="step-title">Request Site</h3>
                        <p class="step-description">
                            Visitor accesses your site via npub subdomain. 
                            Server resolves your public key from the subdomain.
                        </p>
                    </div>
                    <div class="step">
                        <div class="step-number">3</div>
                        <h3 class="step-title">Fetch Mappings</h3>
                        <p class="step-description">
                            Server queries Nostr relays for your file path mappings 
                            and Blossom server preferences.
                        </p>
                    </div>
                    <div class="step">
                        <div class="step-number">4</div>
                        <h3 class="step-title">Serve Content</h3>
                        <p class="step-description">
                            Files are retrieved from Blossom servers using SHA256 hashes 
                            and served with proper headers and caching.
                        </p>
                    </div>
                </div>
            </div>
        </section>

        <section id="example" class="example">
            <div class="container">
                <h2 class="section-title">Quick Start Guide</h2>
                <p style="text-align: center; color: var(--text-secondary); margin-bottom: 3rem;">
                    Deploy your first decentralized website with just a single command.
                </p>
                
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(350px, 1fr)); gap: 2rem; margin-bottom: 3rem;">
                    <div class="feature-card">
                        <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 1rem;">
                            <div style="width: 2rem; height: 2rem; background: linear-gradient(45deg, var(--primary), var(--secondary)); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 0.9rem;">2</div>
                            <h3 style="margin: 0;">Run the fast deploy command</h3>
                        </div>
                        <div class="code-block" style="margin: 0;">cd my-website<br/>npx -y nostr-deploy-cli deploy --skip-setup</div>
                    </div>
                    
                    <div class="feature-card">
                        <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 1rem;">
                            <div style="width: 2rem; height: 2rem; background: linear-gradient(45deg, var(--primary), var(--secondary)); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 0.9rem;">3</div>
                            <h3 style="margin: 0;">Access Your Site</h3>
                        </div>
                        <div class="code-block" style="margin: 0;"><span class="subdomain-example">https://npub1xyz.nostrdeploy.com</span></div>
                    </div>
                </div>

                <div style="background: var(--bg-card); border-radius: 1rem; padding: 2rem; border: 1px solid var(--border);">
                    <h3 style="margin-bottom: 1.5rem; display: flex; align-items: center; gap: 0.5rem;">
                        <span style="font-size: 1.5rem;">📁</span>
                        Example: Deploying a Simple Website
                    </h3>
                    
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; align-items: start;">
                        <div>
                            <h4 style="color: var(--secondary); margin-bottom: 1rem;">Your Local Files:</h4>
                            <div class="code-block" style="font-size: 0.85rem; margin: 0;">my-website/<br/>├── index.html<br/>├── about.html<br/>├── css/<br/>│   └── style.css<br/>├── images/<br/>│   └── logo.png<br/>└── 404.html</div>
                        </div>
                        
                        <div>
                            <h4 style="color: var(--secondary); margin-bottom: 1rem;">Live URLs:</h4>
                            <div style="color: var(--text-secondary); font-size: 0.9rem; line-height: 1.8;">
                                <div><code style="color: var(--secondary);">index.html</code> → <code>/</code></div>
                                <div><code style="color: var(--secondary);">about.html</code> → <code>/about</code></div>
                                <div><code style="color: var(--secondary);">css/style.css</code> → <code>/css/style.css</code></div>
                                <div><code style="color: var(--secondary);">images/logo.png</code> → <code>/images/logo.png</code></div>
                                <div><code style="color: var(--secondary);">404.html</code> → <em>fallback page</em></div>
                            </div>
                        </div>
                    </div>
                    
                    <div style="margin-top: 2rem; padding: 1.5rem; background: rgba(139, 92, 246, 0.1); border-radius: 0.5rem; border-left: 4px solid var(--primary);">
                        <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem;">
                            <span style="font-size: 1.2rem;">💡</span>
                            <strong>How It Works Behind the Scenes:</strong>
                        </div>
                        <p style="margin: 0; color: var(--text-secondary); font-size: 0.9rem;">
                            Your files are uploaded to Blossom servers, and their paths are mapped via signed Nostr events. 
                            When someone visits your site, this server fetches the mapping from Nostr relays and serves the files from Blossom.
                        </p>
                    </div>
                </div>
                
                <div style="text-align: center; margin-top: 3rem;">
                    <p style="color: var(--text-secondary); margin-bottom: 1.5rem;">
                        Ready to deploy your decentralized website?
                    </p>
                    <a href="https://github.com/sepehr-safari/nostr-deploy-cli" class="btn btn-primary" target="_blank">
                        🚀 Get Started with CLI Tool
                    </a>
                </div>
            </div>
        </section>
    </main>

    <footer>
        <div class="container">
            <div class="footer-content">
                <div class="footer-section">
                    <h3>Resources</h3>
                    <a href="https://github.com/nostr-protocol/nostr" target="_blank">Nostr Protocol</a>
                    <a href="https://github.com/hzrd149/blossom" target="_blank">Blossom Protocol</a>
                    <a href="https://nostrhub.io/naddr1qvzqqqrcvypzqfngzhsvjggdlgeycm96x4emzjlwf8dyyzdfg4hefp89zpkdgz99qqt8qatzddjhjttnw3shg6tr94mk2cnnd96x2uch7k70g" target="_blank">NIP Specification</a>
                    <a href="https://github.com/nostr-protocol/nips/" target="_blank">All NIPs</a>
                </div>
                <div class="footer-section">
                    <h3>Source Code</h3>
                    <a href="https://github.com/sepehr-safari/nostr-deploy-server" target="_blank">Nostr-Deploy Server</a>
                    <a href="https://github.com/sepehr-safari/nostr-deploy-cli" target="_blank">Nostr-Deploy CLI Tool</a>
                </div>
            </div>
            <div class="footer-bottom">
                <p>Built with ❤️ for the Open Source and Decentralized Web</p>
            </div>
        </div>
    </footer>

    <script>
        // Add some interactivity
        document.addEventListener('DOMContentLoaded', function() {
            // Smooth scrolling for navigation links
            document.querySelectorAll('a[href^="#"]').forEach(anchor => {
                anchor.addEventListener('click', function (e) {
                    e.preventDefault();
                    const target = document.querySelector(this.getAttribute('href'));
                    if (target) {
                        target.scrollIntoView({
                            behavior: 'smooth',
                            block: 'start'
                        });
                    }
                });
            });

            // Initialize any dynamic content
            console.log('NostrDeploy landing page loaded');
        });
    </script>
</body>
</html>`;

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(landingPageHTML);
      return;
    }

    // For subdomains, continue with the original npub resolution logic
    // Resolve pubkey from hostname
    const pubkeyResolution = nostrHelper.resolvePubkey(hostname);

    if (!pubkeyResolution.isValid) {
      logger.warn(`Invalid npub subdomain: ${hostname}`);
      res.status(404).json({
        error: 'Not Found',
        message: 'Invalid npub subdomain',
      });
      return;
    }

    const { pubkey } = pubkeyResolution;

    // Normalize path - add index.html if path ends with /
    let normalizedPath = requestPath;
    if (normalizedPath.endsWith('/')) {
      normalizedPath += 'index.html';
    } else if (!normalizedPath.includes('.')) {
      // If no extension, assume it's a directory and add /index.html
      normalizedPath += '/index.html';
    }

    logger.debug(`Serving ${normalizedPath} for pubkey: ${pubkey.substring(0, 8)}...`);

    // Get file mapping from Nostr
    const sha256 = await nostrHelper.getStaticFileMapping(pubkey, normalizedPath);

    if (!sha256) {
      logger.warn(
        `No file mapping found for ${normalizedPath} from pubkey: ${pubkey.substring(0, 8)}...`,
        {
          hostname,
          path: normalizedPath,
          pubkey: pubkey.substring(0, 16) + '...',
          userAgent: req.get('User-Agent'),
        }
      );
      res.status(404).json({
        error: 'Not Found',
        message: 'File not found',
      });
      return;
    }

    // Get Blossom servers for this pubkey
    const blossomServers = await nostrHelper.getBlossomServers(pubkey);

    if (blossomServers.length === 0) {
      logger.error(`No Blossom servers available for pubkey: ${pubkey.substring(0, 8)}...`);
      res.status(404).json({
        error: 'Not Found',
        message: 'No Blossom servers available',
      });
      return;
    }

    // Fetch file from Blossom servers
    const fileResponse = await blossomHelper.fetchFile(sha256, blossomServers, normalizedPath);

    if (!fileResponse) {
      logger.error(`Failed to fetch file ${sha256.substring(0, 8)}... from Blossom servers`);
      res.status(404).json({
        error: 'Not Found',
        message: 'File not available from Blossom servers',
      });
      return;
    }

    // Check if this file should be SSR rendered
    const shouldSSR = ssrHelper.shouldRenderSSR(
      fileResponse.contentType,
      normalizedPath,
      req.get('User-Agent')
    );
    const fullUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;

    let finalContent: string | Buffer;
    let finalContentType: string;
    let finalContentLength: number;

    if (shouldSSR) {
      logger.debug(`SSR rendering ${normalizedPath} for ${hostname}`);

      try {
        // Use SSR to render the page
        const ssrResult = await ssrHelper.renderPage(
          fullUrl,
          Buffer.from(fileResponse.content),
          fileResponse.contentType
        );

        finalContent = ssrResult.html;
        finalContentType = ssrResult.contentType;
        finalContentLength = Buffer.byteLength(finalContent, 'utf8');

        logger.info(`SSR completed for ${normalizedPath} (${finalContentLength} bytes)`);
      } catch (ssrError) {
        logger.error(
          `SSR failed for ${normalizedPath}, falling back to original content:`,
          ssrError
        );
        // Fallback to original content
        finalContent = Buffer.from(fileResponse.content);
        finalContentType = fileResponse.contentType;
        finalContentLength = fileResponse.contentLength;
      }
    } else {
      // Use original content for non-HTML files
      finalContent = Buffer.from(fileResponse.content);
      finalContentType = fileResponse.contentType;
      finalContentLength = fileResponse.contentLength;

      // Log content type for debugging
      logger.debug(`Serving asset ${normalizedPath} with content-type: ${finalContentType}`);
    }

    // Set response headers
    res.set({
      'Content-Type': finalContentType,
      'Content-Length': finalContentLength.toString(),
      'Cache-Control': shouldSSR
        ? `public, max-age=${config.ssrCacheTtlSeconds}`
        : 'public, max-age=3600', // Use config for SSR cache
      ETag: `"${sha256}${shouldSSR ? '-ssr' : ''}"`,
      'X-Content-SHA256': sha256,
      'X-Served-By': 'Nostr-Static-Server',
      'X-SSR-Rendered': shouldSSR ? 'true' : 'false',
    });

    // Handle conditional requests
    const ifNoneMatch = req.get('If-None-Match');
    const expectedETag = `"${sha256}${shouldSSR ? '-ssr' : ''}"`;
    if (ifNoneMatch === expectedETag) {
      res.status(304).end();
      return;
    }

    // Send file content
    if (typeof finalContent === 'string') {
      res.send(finalContent);
    } else {
      res.send(finalContent);
    }

    logger.info(
      `Successfully served ${normalizedPath} (${finalContentLength} bytes${
        shouldSSR ? ', SSR rendered' : ''
      }) for pubkey: ${pubkey.substring(0, 8)}...`
    );
  } catch (error) {
    logger.error(`Error serving request for ${hostname}${requestPath}:`, error);

    // Return appropriate error response
    if (error instanceof Error) {
      if (error.message.includes('timeout')) {
        res.status(504).json({
          error: 'Gateway Timeout',
          message: 'Request timed out',
        });
        return;
      } else if (error.message.includes('Rate limited')) {
        res.status(429).json({
          error: 'Too Many Requests',
          message: 'Rate limited by upstream server',
        });
        return;
      }
    }

    res.status(500).json({
      error: 'Internal Server Error',
      message: 'An unexpected error occurred',
    });
  }
});

// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  logger.error('Unhandled error:', err);

  if (res.headersSent) {
    return next(err);
  }

  res.status(500).json({
    error: 'Internal Server Error',
    message: 'An unexpected error occurred',
  });
});

// Graceful shutdown
const server = app.listen(config.port, () => {
  logger.info(`Nostr Static Server listening on port ${config.port}`);
  logger.info(`Base domain: ${config.baseDomain}`);
  logger.info(`Default relays: ${config.defaultRelays.length}`);
  logger.info(`Default Blossom servers: ${config.defaultBlossomServers.length}`);
});

// Handle graceful shutdown
const gracefulShutdown = () => {
  logger.info('Shutting down gracefully...');

  server.close(() => {
    logger.info('HTTP server closed');

    // Close Nostr connections
    nostrHelper.closeAllConnections();

    // Close SSR browser
    ssrHelper.close().catch((error) => {
      logger.error('Error closing SSR helper:', error);
    });

    // Clean up caches
    const {
      pathMappingCache,
      relayListCache,
      blossomServerCache,
      fileContentCache,
    } = require('./utils/cache');
    pathMappingCache.destroy();
    relayListCache.destroy();
    blossomServerCache.destroy();
    fileContentCache.destroy();

    logger.info('Cleanup completed');
    process.exit(0);
  });
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

export default app;
