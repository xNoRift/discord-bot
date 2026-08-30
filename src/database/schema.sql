-- ============================================================
--  Datenbank-Schema (SQLite)
--  Wird bei jedem Start ausgeführt. Alle Tabellen sind
--  "IF NOT EXISTS", bestehende Daten bleiben erhalten.
-- ============================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ---------- Discord Guilds (Server), auf denen der Bot ist ----------
CREATE TABLE IF NOT EXISTS guilds (
  guild_id   TEXT PRIMARY KEY,
  name       TEXT,
  icon       TEXT,
  owner_id   TEXT,
  member_count INTEGER DEFAULT 0,
  bot_present INTEGER DEFAULT 1,
  joined_at  INTEGER,
  updated_at INTEGER
);

-- ---------- Pro-Server-Einstellungen ----------
CREATE TABLE IF NOT EXISTS guild_settings (
  guild_id TEXT PRIMARY KEY,

  -- Allgemein
  log_channel_id TEXT,
  bot_prefix     TEXT DEFAULT '!',
  embed_color    TEXT,
  timezone       TEXT DEFAULT 'Europe/Berlin',
  bot_language   TEXT DEFAULT 'de',
  mod_log_channel_id TEXT,
  suggestions_enabled     INTEGER DEFAULT 0,
  suggestions_channel_id  TEXT,
  team_role_ids  TEXT,
  autorole_ids     TEXT,
  autorole_bot_ids TEXT,

  -- Willkommens-System
  welcome_enabled     INTEGER DEFAULT 0,
  welcome_channel_id  TEXT,
  welcome_message     TEXT,
  welcome_embed       INTEGER DEFAULT 1,
  welcome_color       TEXT,
  welcome_ping        INTEGER DEFAULT 1,
  welcome_dm_enabled  INTEGER DEFAULT 0,
  welcome_dm_message  TEXT,
  leave_enabled       INTEGER DEFAULT 0,
  leave_channel_id    TEXT,
  leave_message       TEXT,

  -- Temp-Voice ("Join to Create")
  tempvoice_enabled        INTEGER DEFAULT 0,
  tempvoice_hub_channel_id TEXT,
  tempvoice_category_id    TEXT,
  tempvoice_name_format    TEXT DEFAULT '{user} • Voice',
  tempvoice_user_limit     INTEGER DEFAULT 0,

  -- Tickets
  tickets_enabled         INTEGER DEFAULT 1,
  ticket_team_ping        INTEGER DEFAULT 1,
  ticket_close_restricted INTEGER DEFAULT 0,
  ticket_on_leave         TEXT DEFAULT 'nothing',
  ticket_category_id     TEXT,
  ticket_support_role_id TEXT,
  ticket_log_channel_id  TEXT,
  ticket_name_format     TEXT DEFAULT 'ticket-{number}',
  ticket_max_per_user    INTEGER DEFAULT 1,
  ticket_welcome_message TEXT,
  ticket_panel_title     TEXT,
  ticket_panel_message   TEXT,
  ticket_panel_channel_id TEXT,
  ticket_panel_message_id TEXT,
  ticket_counter         INTEGER DEFAULT 0,

  -- Giveaways
  giveaway_channel_id            TEXT,
  giveaway_winner_role_id        TEXT,
  giveaway_winner_role_duration_ms INTEGER DEFAULT 86400000,
  giveaway_log_channel_id        TEXT,

  -- Applications / Bewerbungen
  application_enabled          INTEGER DEFAULT 0,
  application_channel_id       TEXT,
  application_team_role_id     TEXT,
  application_log_channel_id   TEXT,
  application_panel_title      TEXT,
  application_panel_message    TEXT,
  application_panel_channel_id TEXT,
  application_panel_message_id TEXT,

  created_at INTEGER,
  updated_at INTEGER
);

-- ---------- Ticket-Panels (mehrere pro Server möglich) ----------
CREATE TABLE IF NOT EXISTS ticket_panels (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT NOT NULL,
  name        TEXT NOT NULL,            -- interner Name im Dashboard
  title       TEXT,                     -- Embed-Titel
  description TEXT,                     -- Embed-Text
  color       TEXT,                     -- optionaler Hex-Wert (#RRGGBB)
  channel_id  TEXT,                     -- wo das Panel gepostet wurde
  message_id  TEXT,
  use_select  INTEGER NOT NULL DEFAULT 0, -- 0 = Buttons, 1 = Auswahlmenü
  button_label TEXT,                    -- Label bei genau EINER Kategorie
  log_channel_id   TEXT,                -- eigener Log-Kanal für dieses Panel
  rating_enabled   INTEGER DEFAULT 0,   -- Bewertung nach Ticket-Schließung
  rating_channel_id TEXT,
  claim_category_id TEXT,               -- übernommene Tickets hierhin verschieben
  autoclose_hours  INTEGER DEFAULT 0,   -- 0 = aus
  created_at  INTEGER,
  updated_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_ticket_panels_guild ON ticket_panels(guild_id);

-- ---------- Ticket-Kategorien (pro Panel) ----------
CREATE TABLE IF NOT EXISTS ticket_categories (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  panel_id           INTEGER NOT NULL,
  guild_id           TEXT NOT NULL,
  label              TEXT NOT NULL,
  emoji              TEXT,
  description        TEXT,
  enabled            INTEGER NOT NULL DEFAULT 1,
  prefix             TEXT,    -- Prefix vor dem Kanalnamen (z.B. "support" -> support-0001)
  max_open           INTEGER DEFAULT 0,  -- max. offene Tickets dieser Kategorie (0 = Serverwert)
  discord_category_id TEXT,   -- Override der Server-Kategorie
  support_role_id    TEXT,    -- Override der Support-Rolle
  ping_role_id       TEXT,    -- zusätzliche Rolle, die beim Öffnen gepingt wird
  welcome_message    TEXT,    -- Override der Begrüßung
  name_format        TEXT,    -- Override des Kanalnamens
  position           INTEGER NOT NULL DEFAULT 0,
  created_at         INTEGER,
  FOREIGN KEY (panel_id) REFERENCES ticket_panels(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ticket_categories_panel ON ticket_categories(panel_id);

-- ---------- Formularfelder pro Ticket-Kategorie (Modal beim Öffnen) ----------
CREATE TABLE IF NOT EXISTS ticket_category_questions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL,
  label       TEXT NOT NULL,
  style       TEXT NOT NULL DEFAULT 'short',   -- short | paragraph
  placeholder TEXT,
  required    INTEGER NOT NULL DEFAULT 1,
  min_length  INTEGER DEFAULT 0,
  max_length  INTEGER DEFAULT 400,
  position    INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (category_id) REFERENCES ticket_categories(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_tcq_category ON ticket_category_questions(category_id);

-- ---------- Tickets ----------
CREATE TABLE IF NOT EXISTS tickets (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id   TEXT NOT NULL,
  channel_id TEXT,
  number     INTEGER,
  opener_id  TEXT NOT NULL,
  claimed_by TEXT,
  status     TEXT NOT NULL DEFAULT 'open',   -- open | closed | deleted
  subject    TEXT,
  panel_id       INTEGER,
  category_id    INTEGER,
  category_label TEXT,
  created_at INTEGER,
  claimed_at INTEGER,
  closed_at  INTEGER,
  closed_by  TEXT,
  reopened_at INTEGER,
  deleted_at INTEGER,
  deleted_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_tickets_guild ON tickets(guild_id);
CREATE INDEX IF NOT EXISTS idx_tickets_channel ON tickets(channel_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(guild_id, status);

-- ---------- Giveaways ----------
CREATE TABLE IF NOT EXISTS giveaways (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id       TEXT NOT NULL,
  channel_id     TEXT NOT NULL,
  message_id     TEXT,
  prize          TEXT NOT NULL,
  description    TEXT,
  winner_count   INTEGER NOT NULL DEFAULT 1,
  required_role_id TEXT,
  host_id        TEXT,
  created_at     INTEGER,
  ends_at        INTEGER NOT NULL,
  ended          INTEGER NOT NULL DEFAULT 0,   -- 0 = laeuft, 1 = beendet
  cancelled      INTEGER NOT NULL DEFAULT 0,
  winner_role_id TEXT,             -- Snapshot: welche Gewinnerrolle vergeben wird
  winner_role_duration_ms INTEGER, -- Snapshot: wie lange die Rolle bleibt
  winners_json   TEXT              -- JSON-Array der aktuellen Gewinner-IDs
);
CREATE INDEX IF NOT EXISTS idx_giveaways_guild ON giveaways(guild_id);
CREATE INDEX IF NOT EXISTS idx_giveaways_active ON giveaways(ended, cancelled);

-- ---------- Giveaway-Teilnahmen ----------
CREATE TABLE IF NOT EXISTS giveaway_entries (
  giveaway_id INTEGER NOT NULL,
  user_id     TEXT NOT NULL,
  entered_at  INTEGER,
  PRIMARY KEY (giveaway_id, user_id),
  FOREIGN KEY (giveaway_id) REFERENCES giveaways(id) ON DELETE CASCADE
);

-- ---------- Giveaway-Gewinner (Historie inkl. Reroll) ----------
CREATE TABLE IF NOT EXISTS giveaway_winners (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  giveaway_id INTEGER NOT NULL,
  user_id     TEXT NOT NULL,
  drawn_at    INTEGER,
  is_reroll   INTEGER NOT NULL DEFAULT 0,
  replaced    INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (giveaway_id) REFERENCES giveaways(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_gw_winners_giveaway ON giveaway_winners(giveaway_id);

-- ---------- Temporaere Rollen (Giveaway-Gewinnerrolle) ----------
CREATE TABLE IF NOT EXISTS temporary_roles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL,
  guild_id    TEXT NOT NULL,
  role_id     TEXT NOT NULL,
  giveaway_id INTEGER,
  reason      TEXT DEFAULT 'giveaway',
  granted_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  removed     INTEGER NOT NULL DEFAULT 0,
  removed_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_temproles_active ON temporary_roles(removed, expires_at);
CREATE INDEX IF NOT EXISTS idx_temproles_user ON temporary_roles(guild_id, user_id, role_id);

-- ---------- Bewerbungsarten (z.B. Support, Moderator) ----------
CREATE TABLE IF NOT EXISTS application_types (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id      TEXT NOT NULL,
  name          TEXT NOT NULL,
  emoji         TEXT,
  description   TEXT,
  accept_role_id TEXT,
  enabled       INTEGER NOT NULL DEFAULT 1,
  position      INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_apptypes_guild ON application_types(guild_id);

-- ---------- Fragen pro Bewerbungsart ----------
CREATE TABLE IF NOT EXISTS application_questions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  type_id    INTEGER NOT NULL,
  label      TEXT NOT NULL,
  style      TEXT NOT NULL DEFAULT 'short',  -- short | paragraph
  required   INTEGER NOT NULL DEFAULT 1,
  min_length INTEGER DEFAULT 0,
  max_length INTEGER DEFAULT 400,
  position   INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (type_id) REFERENCES application_types(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_appquestions_type ON application_questions(type_id);

-- ---------- Eingereichte Bewerbungen ----------
CREATE TABLE IF NOT EXISTS applications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT NOT NULL,
  type_id     INTEGER,
  type_name   TEXT,
  user_id     TEXT NOT NULL,
  user_tag    TEXT,
  answers_json TEXT NOT NULL,          -- JSON: [{ question, answer }]
  status      TEXT NOT NULL DEFAULT 'pending', -- pending | accepted | rejected
  message_id  TEXT,
  channel_id  TEXT,
  reviewer_id TEXT,
  review_note TEXT,
  created_at  INTEGER,
  reviewed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_applications_guild ON applications(guild_id, status);

-- ---------- Globale Bot-Konfiguration (eine Zeile, id = 1) ----------
CREATE TABLE IF NOT EXISTS bot_config (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  presence_status TEXT DEFAULT 'online',   -- online | idle | dnd | invisible
  activity_type   TEXT DEFAULT 'watching', -- playing | watching | listening | competing | streaming | custom | none
  activity_text   TEXT DEFAULT '/help • Dashboard',
  activity_url    TEXT,                     -- nur für "streaming"
  updated_at      INTEGER
);

-- ---------- Temp-Voice: aktive temporäre Sprachkanäle ----------
CREATE TABLE IF NOT EXISTS temp_voice_channels (
  channel_id TEXT PRIMARY KEY,
  guild_id   TEXT NOT NULL,
  owner_id   TEXT NOT NULL,
  locked     INTEGER DEFAULT 0,
  hidden     INTEGER DEFAULT 0,
  created_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_temp_voice_guild ON temp_voice_channels(guild_id);

-- ---------- Dashboard-Nutzer (OAuth2) ----------
CREATE TABLE IF NOT EXISTS dashboard_users (
  user_id          TEXT PRIMARY KEY,
  username         TEXT,
  global_name      TEXT,
  avatar           TEXT,
  access_token     TEXT,
  refresh_token    TEXT,
  token_expires_at INTEGER,
  guilds_json      TEXT,
  guilds_cached_at INTEGER,
  last_login       INTEGER
);

-- ---------- Allgemeines Aktivitaets-Log ----------
CREATE TABLE IF NOT EXISTS activity_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id   TEXT,
  type       TEXT,
  actor_id   TEXT,
  target_id  TEXT,
  message    TEXT,
  meta_json  TEXT,
  created_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_activity_guild ON activity_log(guild_id, created_at);
