'use strict';

/**
 * Web-Dashboard (Express + EJS).
 * Wird von index.js zusammen mit dem Bot gestartet oder eigenständig via `npm run dashboard`.
 */

const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const SqliteStore = require('better-sqlite3-session-store')(session);

const config = require('../config/config');
const logger = require('../src/utils/logger');
const client = require('../src/core/client');
const db = require('../src/database/db');

const { csrfToken } = require('./middleware/auth');
const authRoutes = require('./routes/auth');
const pageRoutes = require('./routes/pages');
const apiRoutes = require('./routes/api');

function createApp() {
  const app = express();

  // Hinweis: NICHT "app.locals.client" nennen – "client" ist eine reservierte
  // EJS-Compile-Option und würde das Template-Rendering (includes) zerstören.
  app.locals.botClient = client;
  app.locals.icon = require('./lib/icons').icon;
  app.locals.brand = config.branding;
  // Cache-Busting: neuer Wert bei jedem Start -> Browser lädt CSS/JS neu.
  app.locals.assetVer = Date.now().toString(36);
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.set('trust proxy', config.isProduction ? 1 : 0);
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          // Nur erzwingen, wenn das Dashboard hinter HTTPS läuft (SECURE_COOKIES=true).
          // Sonst bricht reiner HTTP-Zugriff (z. B. per IP) das Laden von CSS/JS.
          upgradeInsecureRequests: config.dashboard.secureCookies ? [] : null,
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'https://cdn.discordapp.com', 'data:'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'", 'https://discord.com'],
        },
      },
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'same-origin' },
      hsts: config.dashboard.secureCookies,
    }),
  );

  // Größeres Limit nur für Avatar-Uploads (Bild als Base64).
  const bigJson = express.json({ limit: '12mb' });
  app.use((req, res, next) => (/\/avatar$/.test(req.path) ? bigJson(req, res, next) : next()));
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));

  app.use(
    session({
      name: 'dbv1.sid',
      store: new SqliteStore({
        client: db,
        expired: { clear: true, intervalMs: 15 * 60 * 1000 },
      }),
      secret: config.dashboard.sessionSecret,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.dashboard.secureCookies,
        maxAge: 7 * 24 * 60 * 60 * 1000,
      },
    }),
  );

  app.use(csrfToken);

  app.use(
    '/static',
    express.static(path.join(__dirname, 'public'), {
      etag: !config.isProduction ? false : true,
      lastModified: !config.isProduction ? false : true,
      maxAge: config.isProduction ? '7d' : 0,
      setHeaders(res) {
        if (!config.isProduction) res.setHeader('Cache-Control', 'no-store');
      },
    }),
  );

  // View-Locals
  app.use((req, res, next) => {
    res.locals.currentUser = req.session?.user ?? null;
    res.locals.path = req.path;
    next();
  });

  // Request-Logging (ohne statische Assets)
  app.use((req, res, next) => {
    if (req.path.startsWith('/static/') || req.path === '/health') return next();
    const start = Date.now();
    res.on('finish', () => {
      const code = res.statusCode;
      const line = `[http] ${req.method} ${req.originalUrl} -> ${code} (${Date.now() - start}ms)`;
      if (code >= 500) logger.error(line);
      else if (code >= 400) logger.warn(line);
      else logger.info(line);
    });
    next();
  });

  app.use('/auth', authRoutes);
  app.use('/api', apiRoutes);
  app.use('/', pageRoutes);

  app.get('/health', (req, res) => res.json({ ok: true, botReady: client.isReady() }));

  // 404
  app.use((req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Nicht gefunden.' });
    res.status(404).render('error', { title: '404', message: 'Diese Seite existiert nicht.' });
  });

  // Fehlerbehandlung
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    logger.error('[dashboard]', err);
    const status = err.status || 500;
    if (req.path.startsWith('/api/')) {
      return res.status(status).json({ error: err.message || 'Interner Serverfehler.' });
    }
    res.status(status).render('error', {
      title: 'Fehler',
      message: config.isProduction ? 'Interner Serverfehler.' : err.message,
    });
  });

  return app;
}

let server = null;

function startDashboard() {
  const missing = config.validate('dashboard');
  if (missing.length) {
    logger.error(`[dashboard] Fehlende .env-Variablen: ${missing.join(', ')}`);
    throw new Error('Dashboard-Konfiguration unvollständig. Siehe .env.example');
  }

  // Sicherheits-Selbstcheck
  for (const w of config.securityCheck()) {
    if (w.level === 'error') logger.error(`[security] ${w.msg}`);
    else logger.warn(`[security] ${w.msg}`);
  }
  if (config.dashboard.ownerOnly) {
    logger.success(`[security] Owner-Only-Modus aktiv – nur ${config.ownerIds.length} Besitzer-ID(s) dürfen ins Dashboard.`);
  }

  require('../src/database/db'); // Schema sicherstellen

  const app = createApp();
  server = app.listen(config.dashboard.port, () => {
    logger.success(`[dashboard] läuft auf ${config.dashboard.url} (Port ${config.dashboard.port})`);
  });
  return server;
}

if (require.main === module) {
  // Eigenständiger Start: Bot ebenfalls hochfahren, damit Guild-Daten verfügbar sind.
  const { startBot } = require('../src/bot');
  startBot()
    .then(() => startDashboard())
    .catch((err) => {
      logger.error('[dashboard] Start fehlgeschlagen:', err);
      process.exit(1);
    });
}

module.exports = { startDashboard, createApp };
