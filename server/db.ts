import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import fs from 'fs';

const DATA_DIR = path.join(os.homedir(), '.wechat-reader-data');
const DB_PATH = path.join(DATA_DIR, 'subscriptions.db');

let db: Database.Database | null = null;

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function getDb(): Database.Database {
  if (db) return db;
  ensureDataDir();
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      subscribed_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
    )
  `);
  return db;
}

export interface SubscriptionRow {
  id: string;
  username: string;
  name: string;
  type: 'person' | 'group' | 'official_account';
  subscribed_at: number;
}

export function saveSubscriptions(contacts: { id: string; username: string; name: string; type: string }[]): void {
  const database = getDb();
  const insert = database.prepare(
    'INSERT OR REPLACE INTO subscriptions (id, username, name, type, subscribed_at) VALUES (?, ?, ?, ?, ?)'
  );
  const deleteAll = database.prepare('DELETE FROM subscriptions');
  const transaction = database.transaction(() => {
    deleteAll.run();
    const now = Math.floor(Date.now() / 1000);
    for (const c of contacts) {
      insert.run(c.id, c.username, c.name, c.type, now);
    }
  });
  transaction();
}

export function loadSubscriptions(): SubscriptionRow[] {
  const database = getDb();
  return database.prepare('SELECT id, username, name, type, subscribed_at FROM subscriptions ORDER BY subscribed_at DESC').all() as SubscriptionRow[];
}

export function getSubscriptionIds(): string[] {
  const database = getDb();
  const rows = database.prepare('SELECT id FROM subscriptions').all() as { id: string }[];
  return rows.map(r => r.id);
}