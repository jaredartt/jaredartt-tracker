// Shared helpers for the @jaredartt tracker.
// No dependencies — Node 20+ only (native fetch, native fs).

import fs from 'node:fs';
import path from 'node:path';

export const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
export const DATA = path.join(ROOT, 'data');

const HOST = 'https://graph.instagram.com';

export function token() {
  const t = process.env.IG_TOKEN;
  if (!t) {
    throw new Error(
      'IG_TOKEN is not set. In GitHub this comes from the repository secret; ' +
      'locally, run with IG_TOKEN=... node scripts/<script>.mjs'
    );
  }
  return t.trim();
}

/**
 * Call the Instagram Graph API.
 * Throws a readable Error on API errors so the Actions log says what went wrong
 * rather than dumping a raw JSON blob.
 */
export async function api(endpoint, params = {}) {
  const url = new URL(HOST + endpoint);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  url.searchParams.set('access_token', token());

  const res = await fetch(url, { headers: { 'User-Agent': 'jaredartt-tracker' } });
  const body = await res.json().catch(() => ({}));

  if (!res.ok || body.error) {
    const e = body.error || {};
    const err = new Error(
      `Instagram API ${res.status}: ${e.message || 'unknown error'}` +
      (e.code ? ` (code ${e.code}${e.error_subcode ? `/${e.error_subcode}` : ''})` : '')
    );
    err.code = e.code;
    err.subcode = e.error_subcode;
    err.status = res.status;
    throw err;
  }
  return body;
}

// ---------------------------------------------------------------------------
// CSV: plain text, one row per observation. Deliberately boring and portable —
// this is your data, and it should open in any spreadsheet a decade from now.
// ---------------------------------------------------------------------------

export function readCsv(file) {
  const p = path.join(DATA, file);
  if (!fs.existsSync(p)) return { header: [], rows: [] };
  const lines = fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean);
  if (!lines.length) return { header: [], rows: [] };
  const header = splitRow(lines[0]);
  const rows = lines.slice(1).map((l) => {
    const cells = splitRow(l);
    return Object.fromEntries(header.map((h, i) => [h, cells[i] ?? '']));
  });
  return { header, rows };
}

export function writeCsv(file, header, rows) {
  fs.mkdirSync(DATA, { recursive: true });
  const out = [header.join(',')];
  for (const r of rows) out.push(header.map((h) => esc(r[h])).join(','));
  fs.writeFileSync(path.join(DATA, file), out.join('\n') + '\n');
}

/** Append a row, or replace the existing row that shares the same key. */
export function upsertCsv(file, header, row, key) {
  const existing = readCsv(file);
  const rows = existing.rows.filter((r) => r[key] !== String(row[key]));
  rows.push(row);
  rows.sort((a, b) => String(a[key]).localeCompare(String(b[key])));
  writeCsv(file, header, rows);
  return rows.length;
}

function esc(v) {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function splitRow(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

export function readJson(file, fallback) {
  const p = path.join(DATA, file);
  if (!fs.existsSync(p)) return fallback;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}

export function writeJson(file, value) {
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(path.join(DATA, file), JSON.stringify(value, null, 2) + '\n');
}

export const isoDate = (d = new Date()) => d.toISOString().slice(0, 10);
export const isoHour = (d = new Date()) => d.toISOString().slice(0, 13) + ':00:00Z';

export function log(...args) {
  console.log(`[${new Date().toISOString()}]`, ...args);
}
