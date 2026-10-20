// 운영 서버의 장부 (node 내장 sqlite). 블록체인 밖에 두는 것들:
//   users      : 참여자 (닉네임, 초대 관계, 출석 기록)
//   bank_*     : 가상 원화 은행 (통장·준비금 계좌와 이체 기록) — 실제 은행처럼 블록체인 밖에 있다
//   jobs       : 서버가 블록체인에 올리는 거래 대기열 (같은 요청을 두 번 처리하지 않도록 key 가 유일)
//   events     : 블록체인 이벤트 색인 (피드·순위·목록을 빠르게 보여 주려고 복사해 둔 것. 원본은 언제나 체인)
//   images     : 상품·쿠폰 사진 (이벤트에 담긴 것을 꺼내 둔 것)
//   settings   : 관리 페이지에서 바꾸는 운영 값
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DATA_DIR, DEFAULT_SETTINGS } from './config.mjs';

fs.mkdirSync(DATA_DIR, { recursive: true });
export const db = new DatabaseSync(path.join(DATA_DIR, 'tcrypto.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS users (
    addr TEXT PRIMARY KEY, name TEXT UNIQUE, invited_by TEXT, joined_at INTEGER, ip TEXT,
    last_checkin TEXT, streak INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS bank_accounts (id TEXT PRIMARY KEY, balance INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS bank_tx (
    id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER, from_acct TEXT, to_acct TEXT, amount INTEGER,
    kind TEXT, memo TEXT, ref TEXT UNIQUE
  );
  CREATE INDEX IF NOT EXISTS bank_tx_from ON bank_tx(from_acct);
  CREATE INDEX IF NOT EXISTS bank_tx_to ON bank_tx(to_acct);
  CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT UNIQUE, kind TEXT, addr TEXT, label TEXT,
    target TEXT, method TEXT, args TEXT, gas TEXT, meta TEXT,
    status TEXT, tx TEXT, nonce INTEGER, fee TEXT, error TEXT, tries INTEGER DEFAULT 0,
    created_at INTEGER, sent_at INTEGER, done_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status);
  CREATE INDEX IF NOT EXISTS jobs_addr ON jobs(addr);
  CREATE TABLE IF NOT EXISTS events (
    block INTEGER, idx INTEGER, tx TEXT, contract TEXT, name TEXT, args TEXT, time INTEGER,
    a1 TEXT, a2 TEXT, PRIMARY KEY (tx, idx)
  );
  CREATE INDEX IF NOT EXISTS events_name ON events(contract, name);
  CREATE INDEX IF NOT EXISTS events_block ON events(block);
  CREATE INDEX IF NOT EXISTS events_a1 ON events(a1);
  CREATE INDEX IF NOT EXISTS events_a2 ON events(a2);
  CREATE TABLE IF NOT EXISTS images (kind TEXT, id INTEGER, mime TEXT, data BLOB, PRIMARY KEY (kind, id));
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT);
`);

export const now = () => Math.floor(Date.now() / 1000);
/** 한국 날짜 (출석·일일 상한 기준) */
export const today = (t = Date.now()) => new Date(t + 9 * 3600e3).toISOString().slice(0, 10);

export function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}

export const kvGet = (k, d = null) => db.prepare('SELECT value FROM kv WHERE key = ?').get(k)?.value ?? d;
export const kvSet = (k, v) => db.prepare('INSERT INTO kv(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, String(v));

export function settings() {
  const out = { ...DEFAULT_SETTINGS };
  for (const { key, value } of db.prepare('SELECT key, value FROM settings').all()) {
    if (key in out) out[key] = Number(value);
  }
  return out;
}
export function setSettings(patch) {
  const st = db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in DEFAULT_SETTINGS)) continue;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) throw new Error(`${k}: 0 이상 숫자여야 합니다`);
    st.run(k, String(Math.floor(n)));
  }
  return settings();
}
