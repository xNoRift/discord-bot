'use strict';

/**
 * Minimalistischer Konsolen-Logger mit Zeitstempel und Farben.
 * Bewusst ohne externe Abhaengigkeit.
 */

const COLORS = {
  reset: '\x1b[0m',
  gray: '\x1b[90m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
};

function timestamp() {
  return new Date().toISOString().replace('T', ' ').replace('Z', '');
}

function format(level, color, args) {
  const prefix = `${COLORS.gray}${timestamp()}${COLORS.reset} ${color}[${level}]${COLORS.reset}`;
  return [prefix, ...args];
}

const logger = {
  info(...args) {
    console.log(...format('INFO', COLORS.cyan, args));
  },
  success(...args) {
    console.log(...format('OK', COLORS.green, args));
  },
  warn(...args) {
    console.warn(...format('WARN', COLORS.yellow, args));
  },
  error(...args) {
    console.error(...format('ERROR', COLORS.red, args));
  },
  debug(...args) {
    if (process.env.NODE_ENV === 'production') return;
    console.log(...format('DEBUG', COLORS.magenta, args));
  },
};

module.exports = logger;
