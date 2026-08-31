// Connection check. Runs every plausible failure to ground and writes what it
// finds to data/discord-check.json, because GitHub's run logs live on a host
// this session can't reach. Always exits 0 — a failed probe is the result.

import { api, guildId } from './discord-lib.mjs';
import { writeJson, log } from './lib.mjs';

const out = {};
const t = (process.env.DISCORD_TOKEN || '').trim();
out.token = { present: Boolean(t), length: t.length, prefix: t.slice(0, 6) || null };
out.guild_id_env = (process.env.DISCORD_GUILD_ID || '').trim() || null;

async function step(name, fn) {
  try { out[name] = { ok: true, value: await fn() }; log(`OK   ${name}`); }
  catch (e) { out[name] = { ok: false, error: e.message, status: e.status, code: e.code }; log(`FAIL ${name} — ${e.message}`); }
}

await step('identity', async () => {
  const me = await api('/users/@me');
  return { id: me.id, username: me.username, bot: me.bot };
});

await step('guilds_the_bot_is_in', async () => {
  const gs = await api('/users/@me/guilds');
  return gs.map((g) => ({ id: g.id, name: g.name }));
});

await step('target_guild', async () => {
  const g = await api(`/guilds/${guildId()}`, { with_counts: true });
  return { id: g.id, name: g.name, members: g.approximate_member_count, online: g.approximate_presence_count };
});

await step('members_intent', async () => {
  const m = await api(`/guilds/${guildId()}/members`, { limit: 1 });
  return { returned: m.length, sample_joined_at: m[0]?.joined_at ?? null };
});

await step('channels', async () => {
  const c = await api(`/guilds/${guildId()}/channels`);
  return { total: c.length, text: c.filter((x) => [0, 5].includes(x.type)).length };
});

writeJson('discord-check.json', out);
log('Wrote data/discord-check.json');
