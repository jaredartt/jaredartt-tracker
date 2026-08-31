// Discord REST client for the Artist Academy tracker.
// No dependencies — Node 20+ only.

import { createHash } from 'node:crypto';
import { readJson, writeJson, log } from './lib.mjs';

const BASE = 'https://discord.com/api/v10';
const DISCORD_EPOCH = 1420070400000n;

export const guildId = () => {
  const g = process.env.DISCORD_GUILD_ID;
  if (!g) throw new Error('DISCORD_GUILD_ID is not set (the server ID).');
  return g.trim();
};

const token = () => {
  const t = process.env.DISCORD_TOKEN;
  if (!t) throw new Error('DISCORD_TOKEN is not set (the bot token).');
  return t.trim();
};

// Snowflake IDs embed their creation time, which is how we ask for "messages
// from this day" without downloading everything and filtering.
export const snowflakeToMs = (id) => Number((BigInt(id) >> 22n) + DISCORD_EPOCH);
export const msToSnowflake = (ms) => ((BigInt(Math.floor(ms)) - DISCORD_EPOCH) << 22n).toString();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * One request, with Discord's rate limiter respected rather than fought.
 * Discord tells you exactly how long to wait; the only wrong move is retrying
 * immediately and getting the bot flagged for abuse.
 */
export async function api(path, params = {}, { attempt = 0 } = {}) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }

  const res = await fetch(url, {
    headers: {
      Authorization: `Bot ${token()}`,
      'User-Agent': 'ArtistAcademyTracker (https://github.com/jaredartt/jaredartt-tracker, 1.0)',
    },
  });

  if (res.status === 429) {
    const body = await res.json().catch(() => ({}));
    const wait = Math.ceil((body.retry_after ?? 1) * 1000) + 250;
    if (attempt > 6) throw new Error(`Rate limited repeatedly on ${path}`);
    log(`  rate limited — waiting ${(wait / 1000).toFixed(1)}s`);
    await sleep(wait);
    return api(path, params, { attempt: attempt + 1 });
  }

  if (res.status >= 500 && attempt < 4) {
    await sleep(1000 * (attempt + 1));
    return api(path, params, { attempt: attempt + 1 });
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(`Discord API ${res.status}: ${body.message || res.statusText}`);
    err.status = res.status;
    err.code = body.code;
    throw err;
  }

  // Stay comfortably inside the per-route budget rather than sprinting into it.
  const remaining = Number(res.headers.get('x-ratelimit-remaining'));
  if (remaining === 0) {
    await sleep(Math.ceil(Number(res.headers.get('x-ratelimit-reset-after') || 1) * 1000) + 100);
  }

  return res.json();
}

// ---------------------------------------------------------------------------
// Author naming.
//
// This repository is public. Publishing a leaderboard of your members' names
// and message counts is a decision about *their* privacy, not just yours — so
// names are pseudonymised by default. Set the DISCORD_SHOW_NAMES repository
// variable to "true" if you decide real names are appropriate.
// ---------------------------------------------------------------------------
export const showRealNames = () => process.env.DISCORD_SHOW_NAMES === 'true';

export function authorLabel(user) {
  if (showRealNames()) return user.global_name || user.username || 'unknown';
  const h = createHash('sha256').update(`${guildId()}:${user.id}`).digest('hex');
  return 'Member ' + h.slice(0, 4).toUpperCase();
}

// ---------------------------------------------------------------------------

export async function guild() {
  return api(`/guilds/${guildId()}`, { with_counts: true });
}

/** Text channels the bot can actually see, plus any active threads. */
export async function readableChannels() {
  const all = await api(`/guilds/${guildId()}/channels`);
  // 0 = text, 5 = announcement, 15 = forum (its posts are threads)
  const text = all.filter((c) => [0, 5].includes(c.type));

  let threads = [];
  try {
    const active = await api(`/guilds/${guildId()}/threads/active`);
    threads = (active.threads || []).map((t) => ({ ...t, isThread: true }));
  } catch {
    // Missing permission for threads shouldn't sink the whole run.
  }
  return [...text, ...threads];
}

/**
 * Walk one channel's history backwards until we pass `sinceMs`.
 * Returns messages newest-first; stops as soon as it is old enough, so a daily
 * run costs a couple of requests rather than a full history scan.
 */
export async function messagesSince(channelId, sinceMs, { onBatch } = {}) {
  let before = undefined;
  let fetched = 0;

  for (;;) {
    let batch;
    try {
      batch = await api(`/channels/${channelId}/messages`, { limit: 100, before });
    } catch (err) {
      if (err.status === 403) return { fetched, forbidden: true };
      throw err;
    }
    if (!batch.length) break;

    const keep = batch.filter((m) => Date.parse(m.timestamp) >= sinceMs);
    if (keep.length) { onBatch?.(keep); fetched += keep.length; }

    if (keep.length < batch.length) break;       // crossed the cutoff
    before = batch[batch.length - 1].id;
    if (batch.length < 100) break;               // reached the start of the channel
  }
  return { fetched, forbidden: false };
}

/** Every member, for their joined_at dates. Needs the GUILD_MEMBERS intent. */
export async function allMembers() {
  const out = [];
  let after = '0';
  for (;;) {
    const batch = await api(`/guilds/${guildId()}/members`, { limit: 1000, after });
    out.push(...batch);
    if (batch.length < 1000) break;
    after = batch[batch.length - 1].user.id;
  }
  return out;
}

export { readJson, writeJson, log };
