// Keep the access token alive.
//
// Instagram long-lived tokens expire after 60 days. This is the single most
// common way a self-built tracker dies quietly: it works beautifully for two
// months, then stops, and by the time you notice you've lost weeks of history.
// This runs weekly, renews the token, and writes the new one straight back into
// the repository secret so you never think about it again.

import { execFileSync } from 'node:child_process';
import { api, log } from './lib.mjs';

const res = await api('/refresh_access_token', { grant_type: 'ig_refresh_token' });

const fresh = res.access_token;
const days = Math.round((res.expires_in || 0) / 86400);
if (!fresh) throw new Error('Refresh succeeded but returned no token.');

log(`Token refreshed — valid for another ${days} days.`);

if (!process.env.GH_PAT) {
  log('GH_PAT is not set, so the new token could not be saved back to the secret.');
  log('Add the GH_PAT secret (see SETUP.md, step 9) or the tracker will stop in ~60 days.');
  process.exit(1);
}

execFileSync('gh', ['secret', 'set', 'IG_TOKEN', '--body', fresh], {
  stdio: 'inherit',
  env: { ...process.env, GH_TOKEN: process.env.GH_PAT },
});

log('New token written to the IG_TOKEN repository secret.');
