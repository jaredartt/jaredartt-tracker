// Count messages across the server, day by day.
//
// Used for both the daily job (a two-day window, so yesterday is always
// complete and today is a live partial) and the one-off backfill (90 days).
// Re-running is safe: every date it touches is rewritten from scratch rather
// than added to, so a repeated run can never double-count.
//
//   node scripts/discord-messages.mjs [days]     default 2

import { readableChannels, messagesSince, authorLabel, showRealNames, log } from './discord-lib.mjs';
import { readCsv, writeCsv, writeJson } from './lib.mjs';

const days = Number(process.argv[2] || 2);
const sinceMs = Date.now() - days * 86400_000;
const dayOf = (iso) => iso.slice(0, 10);          // UTC date of the message

// Only real posts. Type 0 is a normal message, 19 is a reply; everything else
// is a system notice ("X joined the server") and would inflate the counts.
const COUNTABLE = new Set([0, 19]);

const perDay = new Map();      // date -> { messages, humans, bots, authors:Set }
const perChannel = new Map();  // date + channel -> count
const perAuthor = new Map();   // date + author -> count

// Keys pair a date with a name. Thread names and pseudonyms both contain
// spaces, so the separator has to be something a name can never hold.
const SEP = '\u0001';
const key = (date, name) => `${date}${SEP}${name}`;
const bump = (map, k) => map.set(k, (map.get(k) || 0) + 1);

const channels = await readableChannels();
log(`Scanning ${channels.length} channels for the last ${days} day(s)`);

let forbidden = 0, total = 0;

for (const ch of channels) {
  const res = await messagesSince(ch.id, sinceMs, {
    onBatch(batch) {
      for (const m of batch) {
        if (!COUNTABLE.has(m.type)) continue;
        const date = dayOf(m.timestamp);
        if (!perDay.has(date)) perDay.set(date, { messages: 0, humans: 0, bots: 0, authors: new Set() });
        const d = perDay.get(date);

        const isBot = Boolean(m.author?.bot) || Boolean(m.webhook_id);
        d.messages++;
        if (isBot) { d.bots++; continue; }        // humans only from here down

        d.humans++;
        d.authors.add(m.author.id);
        bump(perChannel, key(date, ch.name ?? ch.id));
        bump(perAuthor, key(date, authorLabel(m.author)));
      }
    },
  });
  if (res.forbidden) { forbidden++; continue; }
  total += res.fetched;
}

if (forbidden) log(`${forbidden} channel(s) not readable by the bot — skipped`);
log(`Read ${total} messages across ${perDay.size} day(s)`);

// --- write, replacing whole dates -----------------------------------------
const touched = new Set(perDay.keys());
// The newest date is "today so far" and will be rewritten tomorrow anyway.

function rewrite(file, header, rows, keyDate = 'date') {
  const existing = readCsv(file).rows.filter((r) => !touched.has(r[keyDate]));
  const all = [...existing, ...rows].sort((a, b) =>
    a[keyDate].localeCompare(b[keyDate]) || String(a[header[1]]).localeCompare(String(b[header[1]])));
  writeCsv(file, header, all);
  return all.length;
}

const dayRows = [...perDay.entries()].sort().map(([date, d]) => ({
  date, messages: d.messages, humans: d.humans, bots: d.bots, authors: d.authors.size,
}));
rewrite('discord-messages.csv', ['date', 'messages', 'humans', 'bots', 'authors'], dayRows);

const splitKey = (k) => { const i = k.indexOf(SEP); return [k.slice(0, i), k.slice(i + 1)]; };
const chanRows = [...perChannel.entries()].map(([k, messages]) => {
  const [date, channel] = splitKey(k);
  return { date, channel, messages };
});
rewrite('discord-channel-daily.csv', ['date', 'channel', 'messages'], chanRows);

const authorRows = [...perAuthor.entries()].map(([k, messages]) => {
  const [date, author] = splitKey(k);
  return { date, author, messages };
});
rewrite('discord-authors.csv', ['date', 'author', 'messages'], authorRows);

// Keep the author file to the same 90-day window as everything else.
const cutoff = new Date(Date.now() - 95 * 86400_000).toISOString().slice(0, 10);
for (const file of ['discord-authors.csv', 'discord-channel-daily.csv']) {
  const { header, rows } = readCsv(file);
  const kept = rows.filter((r) => r.date >= cutoff);
  if (kept.length !== rows.length) writeCsv(file, header, kept);
}

writeJson('discord-meta.json', {
  names: showRealNames() ? 'real' : 'pseudonymous',
  updated: new Date().toISOString(),
});

for (const r of dayRows.slice(-3)) {
  log(`  ${r.date}: ${r.messages} messages (${r.humans} human, ${r.bots} bot) from ${r.authors} people`);
}
