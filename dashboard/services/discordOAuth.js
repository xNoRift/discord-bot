'use strict';

const config = require('../../config/config');
const dashboardUsers = require('../../src/database/models/dashboardUsers');
const logger = require('../../src/utils/logger');

/**
 * Discord OAuth2 – ohne externe Abhaengigkeit, nur mit dem globalen fetch (Node 18+).
 */

const API = config.oauth.apiBase;

function buildAuthorizeUrl(state) {
  const params = new URLSearchParams({
    client_id: config.discord.clientId,
    redirect_uri: config.dashboard.redirectUri,
    response_type: 'code',
    scope: config.oauth.scopes.join(' '),
    state,
    prompt: 'none',
  });
  return `${config.oauth.authorizeUrl}?${params.toString()}`;
}

async function exchangeCode(code) {
  const body = new URLSearchParams({
    client_id: config.discord.clientId,
    client_secret: config.discord.clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.dashboard.redirectUri,
  });

  const res = await fetch(config.oauth.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token-Austausch fehlgeschlagen (${res.status}): ${text}`);
  }
  return res.json();
}

async function refreshToken(refresh_token) {
  const body = new URLSearchParams({
    client_id: config.discord.clientId,
    client_secret: config.discord.clientSecret,
    grant_type: 'refresh_token',
    refresh_token,
  });
  const res = await fetch(config.oauth.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`Token-Refresh fehlgeschlagen (${res.status})`);
  return res.json();
}

async function apiGet(pathname, accessToken) {
  const res = await fetch(`${API}${pathname}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 429) {
    const data = await res.json().catch(() => ({ retry_after: 1 }));
    throw Object.assign(new Error('rate_limited'), { retryAfter: data.retry_after ?? 1 });
  }
  if (!res.ok) throw new Error(`Discord API ${pathname} -> ${res.status}`);
  return res.json();
}

/**
 * Gibt einen gueltigen Access-Token fuer den Nutzer zurueck und erneuert ihn bei Bedarf.
 */
async function getValidAccessToken(userId) {
  const row = dashboardUsers.get(userId);
  if (!row) return null;
  if (row.token_expires_at && row.token_expires_at - Date.now() > 60_000) {
    return row.access_token;
  }
  try {
    const refreshed = await refreshToken(row.refresh_token);
    dashboardUsers.updateTokens(userId, {
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token,
      expiresInSec: refreshed.expires_in,
    });
    return refreshed.access_token;
  } catch (err) {
    logger.warn(`[oauth] Refresh für ${userId} fehlgeschlagen: ${err.message}`);
    return row.access_token; // letzter Versuch
  }
}

async function fetchCurrentUser(accessToken) {
  return apiGet('/users/@me', accessToken);
}

async function fetchUserGuilds(accessToken) {
  return apiGet('/users/@me/guilds', accessToken);
}

module.exports = {
  buildAuthorizeUrl,
  exchangeCode,
  refreshToken,
  getValidAccessToken,
  fetchCurrentUser,
  fetchUserGuilds,
};
