'use strict';

const db = require('../db');

/**
 * Login-Protokoll fürs Dashboard – wer sich wann von welcher IP eingeloggt
 * (oder es versucht) hat. Nur für den Bot-Besitzer einsehbar.
 */

function record({ userId, username, ip, userAgent, ok = true }) {
  db.prepare(
    `INSERT INTO login_audit (user_id, username, ip, user_agent, ok, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(userId ?? null, username ?? null, ip ?? null, (userAgent ?? '').slice(0, 300), ok ? 1 : 0, Date.now());

  // Alte Einträge kappen (nur die letzten 200 behalten).
  db.prepare(
    `DELETE FROM login_audit WHERE id NOT IN (SELECT id FROM login_audit ORDER BY id DESC LIMIT 200)`,
  ).run();
}

function recent(limit = 20) {
  return db.prepare('SELECT * FROM login_audit ORDER BY id DESC LIMIT ?').all(Math.min(100, Math.max(1, limit)));
}

module.exports = { record, recent };
