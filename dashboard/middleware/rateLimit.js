'use strict';

const rateLimit = require('express-rate-limit');

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Zu viele Anfragen. Bitte kurz warten.' },
});

const authLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Zu viele Login-Versuche. Bitte später erneut versuchen.' },
});

// Strengeres Limit fuer "teure" Aktionen (Panels posten, Giveaways erstellen)
const actionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Zu viele Aktionen in kurzer Zeit. Bitte warte einen Moment.' },
});

module.exports = { apiLimiter, authLimiter, actionLimiter };
