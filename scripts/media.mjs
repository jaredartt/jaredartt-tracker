// Post history + per-post performance.
//
// Feeds the "best posting times" panel. Posts older than the refresh window are
// left alone: their numbers have long since settled, and re-fetching hundreds of
// them every day would be a waste of API calls and of your rate limit.

import { api, readJson, writeJson, log } from './lib.mjs';

const REFRESH_WINDOW_DAYS = 28;   // posts younger than this get re-measured daily
const MAX_PAGES = 20;             // ~2,000 posts, plenty of headroom

const MEDIA_METRICS = ['reach', 'views', 'saved', 'shares', 'total_interactions'];

async function listMedia() {
  const out = [];
  let url = '/me/media';
  let params = {
    fields: 'id,timestamp,media_type,media_product_type,permalink,caption,like_count,comments_count',
    limit: 100,
  };

  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await api(url, params);
    out.push(...(res.data || []));
    const next = res.paging?.cursors?.after;
    if (!next || !res.data?.length) break;
    params = { ...params, after: next };
  }
  return out;
}

async function mediaInsights(id) {
  const out = {};
  for (const metric of MEDIA_METRICS) {
    try {
      const res = await api(`/${id}/insights`, { metric });
      const v = res?.data?.[0];
      const value = v?.total_value?.value ?? v?.values?.[0]?.value;
      if (typeof value === 'number') out[metric] = value;
    } catch {
      // Metric doesn't apply to this media type (stories, older posts). Skip quietly.
    }
  }
  return out;
}

// --- run -------------------------------------------------------------------
const previous = readJson('media.json', []);
const byId = new Map(previous.map((m) => [m.id, m]));

const live = await listMedia();
log(`${live.length} posts visible via the API`);

const cutoff = Date.now() - REFRESH_WINDOW_DAYS * 86400_000;
let measured = 0;

for (const m of live) {
  const known = byId.get(m.id);
  const age = Date.parse(m.timestamp);
  const needsInsights = !known?.insights || age > cutoff;

  const record = {
    id: m.id,
    timestamp: m.timestamp,
    media_type: m.media_product_type || m.media_type || '',
    permalink: m.permalink || '',
    caption: (m.caption || '').replace(/\s+/g, ' ').slice(0, 120),
    like_count: m.like_count ?? null,
    comments_count: m.comments_count ?? null,
    insights: known?.insights ?? null,
  };

  if (needsInsights) {
    record.insights = await mediaInsights(m.id);
    measured++;
    await new Promise((r) => setTimeout(r, 120));
  }

  byId.set(m.id, record);
}

const all = [...byId.values()].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
writeJson('media.json', all);

log(`Stored ${all.length} posts (${measured} re-measured this run)`);
