require('dotenv').config();
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.env.DATABASE_PATH || './nfcgo.db';
const db = new Database(path.resolve(dbPath));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS businesses (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    name      TEXT    NOT NULL,
    slug      TEXT    NOT NULL UNIQUE,
    logo_url  TEXT,
    reward_text TEXT  NOT NULL,
    active    INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS nfc_tags (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    tag_code      TEXT    NOT NULL UNIQUE,
    business_id   INTEGER NOT NULL REFERENCES businesses(id),
    discount_code TEXT    NOT NULL,
    status        TEXT    NOT NULL DEFAULT 'active' CHECK(status IN ('active','claimed','disabled')),
    claimed_at    DATETIME,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_nfc_tags_tag_code ON nfc_tags(tag_code);
  CREATE INDEX IF NOT EXISTS idx_nfc_tags_business  ON nfc_tags(business_id);
`);

module.exports = db;
