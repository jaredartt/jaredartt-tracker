// Shared by index.html and discord.html — chart engine, formatting and theme.
// Both dashboards draw from this so they can never drift apart visually.

// ===========================================================================
//  Data loading
// ===========================================================================
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

function parseCsv(text) {
  // Tolerate CRLF — Excel and Numbers rewrite files that way, and a stray \r
  // silently corrupts the last column's name and value.
  const lines = text.replace(/\r\n?/g, '\n').trim().split('\n').filter(Boolean);
  if (!lines.length) return [];
  const head = splitRow(lines[0]);
  return lines.slice(1).map(l => {
    const c = splitRow(l); const o = {};
    head.forEach((h, i) => { o[h] = c[i] ?? ''; });
    return o;
  });
}
function splitRow(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur); return out;
}
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };

async function load(path, parser) {
  try {
    const res = await fetch(path, { cache: 'no-store' });
    if (!res.ok) return null;
    return parser(await res.text());
  } catch { return null; }
}

// ===========================================================================
//  Formatting
// ===========================================================================
const fmt = n => n === null || n === undefined ? '—' : n.toLocaleString('en-US');
const compact = n => {
  if (n === null || n === undefined) return '—';
  const a = Math.abs(n);
  if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
  if (a >= 1e4) return (n / 1e3).toFixed(0) + 'K';
  if (a >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(Math.round(n));
};
const signed = n => (n > 0 ? '+' : '') + fmt(n);
const dayName = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const fmtDate = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
// Axis labels stay short; tooltips carry the year, because "3 Jun" is ambiguous
// the moment a chart spans more than twelve months.
const fmtDateFull = d => new Date(d + 'T12:00:00Z')
  .toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const hourLabel = h => String(h).padStart(2, '0') + ':00';

function localParts(iso) {
  const d = new Date(iso);
  return { date: d.toLocaleDateString('en-CA'), hour: d.getHours(), weekday: (d.getDay() + 6) % 7 };
}

/** Numbers that count up on arrival — but never a wrong number, even briefly. */
function countUp(node, value, format = fmt) {
  if (value === null || value === undefined) { node.textContent = '—'; return; }
  if (REDUCED) { node.textContent = format(value); return; }
  const dur = 620, t0 = performance.now(), from = 0;
  const step = (t) => {
    const p = Math.min(1, (t - t0) / dur);
    const eased = 1 - Math.pow(1 - p, 3);
    node.textContent = format(Math.round(from + (value - from) * eased));
    if (p < 1) requestAnimationFrame(step); else node.textContent = format(value);
  };
  requestAnimationFrame(step);
}

// ===========================================================================
//  Chart primitives — plain SVG, no libraries.
// ===========================================================================
const SVG = 'http://www.w3.org/2000/svg';
let uid = 0;
const el = (name, attrs = {}) => {
  const n = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};
const css = (host, prop) => getComputedStyle(host).getPropertyValue(prop).trim();

function mountTip(host) {
  let tip = host.querySelector('.tip');
  if (!tip) { tip = document.createElement('div'); tip.className = 'tip'; host.appendChild(tip); }
  return {
    show(x, y, label, value) {
      tip.innerHTML = `<div class="t-label"></div><div class="t-value"></div>`;
      tip.firstChild.textContent = label;
      tip.lastChild.textContent = value;
      tip.style.left = x + 'px'; tip.style.top = y + 'px';
      tip.classList.add('on');
    },
    hide() { tip.classList.remove('on'); },
  };
}

function responsive(host, draw) {
  let raf, lastW = -1;
  const run = () => {
    const w = host.clientWidth;
    if (w > 0 && w !== lastW) { lastW = w; draw(w); }
  };
  new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(run); }).observe(host);
  run();
}

function niceTicks(min, max, count = 3) {
  if (min === max) { min -= 1; max += 1; }
  const raw = (max - min) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
  const out = [];
  for (let v = Math.floor(min / step) * step; v <= Math.ceil(max / step) * step + step / 2; v += step)
    out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

/** Tick format from step size, not magnitude: 10K/10K/11K says nothing. */
function tickFmt(ticks) {
  const step = ticks.length > 1 ? Math.abs(ticks[1] - ticks[0]) : 1;
  if (step >= 1000) return compact;
  if (step >= 1) return v => Math.round(v).toLocaleString('en-US');
  const dp = Math.min(2, Math.max(1, Math.ceil(-Math.log10(step))));
  return v => v.toFixed(dp);
}

const emptyState = (host, msg) => { host.innerHTML = `<div class="empty">${msg}</div>`; };

// --- line chart ------------------------------------------------------------
function lineChart(host, points, opts = {}) {
  if (!points || points.length < 2)
    return emptyState(host, opts.empty || 'Not enough data yet — this fills in as snapshots arrive.');
  const tip = mountTip(host);

  responsive(host, (W) => {
    const H = opts.height || 260;
    const pad = { t: 22, r: 58, b: 30, l: 4 };
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const accent = css(host, '--accent') || '#2b6bff';
    const wash = css(host, '--wash') || '43,107,255';

    const ys = points.map(p => p.y);
    const ticks = niceTicks(Math.min(...ys), Math.max(...ys), 3);
    const y0 = ticks[0], y1 = ticks[ticks.length - 1];
    const label = tickFmt(ticks);
    const X = i => pad.l + (i / (points.length - 1)) * iw;
    const Y = v => pad.t + ih - ((v - y0) / (y1 - y0)) * ih;

    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, height: H, role: 'img' });
    const gid = `g${++uid}`;
    const defs = el('defs');
    const grad = el('linearGradient', { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 });
    grad.appendChild(el('stop', { offset: '0%',   'stop-color': accent, 'stop-opacity': .28 }));
    grad.appendChild(el('stop', { offset: '100%', 'stop-color': accent, 'stop-opacity': 0 }));
    defs.appendChild(grad);
    svg.appendChild(defs);

    // Gridlines only where a value sits — three faint rules, no boxing frame.
    for (const t of ticks) {
      svg.appendChild(el('line', {
        x1: pad.l, x2: pad.l + iw, y1: Y(t), y2: Y(t), stroke: 'var(--grid)', 'stroke-width': 1,
      }));
      const lab = el('text', {
        x: pad.l + iw + 10, y: Y(t) + 4, fill: 'var(--muted)', 'font-size': 11.5,
        'font-family': 'Lexend, sans-serif', 'font-variant-numeric': 'tabular-nums',
      });
      lab.textContent = label(t);
      svg.appendChild(lab);
    }

    const seg = (a, b) => points.slice(a, b + 1)
      .map((p, i) => `${i ? 'L' : 'M'}${X(a + i).toFixed(2)},${Y(p.y).toFixed(2)}`).join(' ');
    const d = seg(0, points.length - 1);

    svg.appendChild(el('path', {
      d: `${d} L${X(points.length - 1)},${pad.t + ih} L${X(0)},${pad.t + ih} Z`,
      fill: `url(#${gid})`,
    }));

    // Reconstructed history is dashed, so an estimate never poses as a measurement.
    let lastEst = -1;
    for (let i = 0; i < points.length; i++) if (points[i].est) lastEst = i;

    const strokes = [];
    if (lastEst >= 1) strokes.push(el('path', {
      d: seg(0, lastEst), fill: 'none', stroke: accent, 'stroke-width': 2.5,
      'stroke-linecap': 'round', 'stroke-linejoin': 'round',
      'stroke-dasharray': '1 7', opacity: .55,
    }));
    strokes.push(el('path', {
      d: seg(Math.max(0, lastEst), points.length - 1), fill: 'none', stroke: accent,
      'stroke-width': 3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
      style: `filter: drop-shadow(0 4px 12px rgba(${wash},.45))`,
    }));
    strokes.forEach(s => svg.appendChild(s));

    // The solid line draws itself in.
    const solid = strokes[strokes.length - 1];
    if (!REDUCED && solid.getTotalLength) {
      requestAnimationFrame(() => {
        const len = solid.getTotalLength();
        if (!len) return;
        solid.style.strokeDasharray = len;
        solid.style.strokeDashoffset = len;
        solid.style.transition = 'stroke-dashoffset .9s cubic-bezier(.3,.8,.3,1)';
        requestAnimationFrame(() => { solid.style.strokeDashoffset = '0'; });
      });
    }

    const xlab = (i, anchor) => {
      const t = el('text', {
        x: X(i), y: H - 6, fill: 'var(--muted)', 'font-size': 11.5,
        'font-family': 'Lexend, sans-serif', 'text-anchor': anchor,
      });
      t.textContent = points[i].label;
      svg.appendChild(t);
    };
    xlab(0, 'start'); xlab(points.length - 1, 'end');

    const lastP = points[points.length - 1];
    const halo = el('circle', {
      cx: X(points.length - 1), cy: Y(lastP.y), r: 5, fill: accent, opacity: .5,
    });
    if (!REDUCED) halo.style.animation = 'pulse 2.4s ease-out infinite';
    svg.appendChild(halo);
    svg.appendChild(el('circle', {
      cx: X(points.length - 1), cy: Y(lastP.y), r: 5, fill: accent,
      stroke: 'var(--page)', 'stroke-width': 3,
    }));

    const cross = el('line', { y1: pad.t - 6, y2: pad.t + ih, stroke: accent, 'stroke-width': 1.5, opacity: 0 });
    const dot = el('circle', { r: 5.5, fill: accent, stroke: 'var(--page)', 'stroke-width': 3, opacity: 0 });
    svg.appendChild(cross); svg.appendChild(dot);

    const hit = el('rect', { x: 0, y: 0, width: W, height: H, fill: 'transparent' });
    hit.addEventListener('pointermove', ev => {
      const r = svg.getBoundingClientRect();
      const px = (ev.clientX - r.left) * (W / r.width);
      const i = Math.max(0, Math.min(points.length - 1, Math.round(((px - pad.l) / iw) * (points.length - 1))));
      const p = points[i];
      cross.setAttribute('x1', X(i)); cross.setAttribute('x2', X(i)); cross.setAttribute('opacity', .25);
      dot.setAttribute('cx', X(i)); dot.setAttribute('cy', Y(p.y)); dot.setAttribute('opacity', 1);
      tip.show(X(i) * (r.width / W), Y(p.y) * (r.height / H),
        (p.tipLabel || p.label) + (p.est ? ' · reconstructed' : ''), (opts.unit || '') + fmt(p.y));
    });
    hit.addEventListener('pointerleave', () => {
      cross.setAttribute('opacity', 0); dot.setAttribute('opacity', 0); tip.hide();
    });
    svg.appendChild(hit);

    host.querySelectorAll('svg').forEach(s => s.remove());
    host.prepend(svg);
  });
}

// --- column chart ----------------------------------------------------------
function columnChart(host, bars, opts = {}) {
  if (!bars || !bars.length) return emptyState(host, opts.empty || 'Nothing to show yet.');
  const tip = mountTip(host);

  responsive(host, (W) => {
    const H = opts.height || 230;
    const pad = { t: 20, r: 58, b: 30, l: 4 };
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const accent = css(host, '--accent') || '#2b6bff';
    const gain = css(host, '--gain');
    const loss = css(host, '--loss');

    const vals = bars.map(b => b.value);
    const ticks = niceTicks(Math.min(0, ...vals), Math.max(0, ...vals), 3);
    const y0 = ticks[0], y1 = ticks[ticks.length - 1];
    const label = tickFmt(ticks);
    const Y = v => pad.t + ih - ((v - y0) / (y1 - y0)) * ih;

    const band = iw / bars.length;
    const bw = Math.min(opts.maxBar || 22, Math.max(3, band - 3));
    const r = bw / 2;

    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, height: H, role: 'img' });

    for (const t of ticks) {
      svg.appendChild(el('line', {
        x1: pad.l, x2: pad.l + iw, y1: Y(t), y2: Y(t),
        stroke: 'var(--grid)', 'stroke-width': t === 0 ? 1.5 : 1,
      }));
      const lab = el('text', {
        x: pad.l + iw + 10, y: Y(t) + 4, fill: 'var(--muted)', 'font-size': 11.5,
        'font-family': 'Lexend, sans-serif', 'font-variant-numeric': 'tabular-nums',
      });
      lab.textContent = label(t);
      svg.appendChild(lab);
    }

    const base = Y(0);
    bars.forEach((b, i) => {
      const cx = pad.l + band * i + band / 2;
      const y = Y(b.value);
      const h = Math.abs(y - base);
      const up = b.value >= 0;
      // Direction is carried by position AND colour, so the teal/coral pair is
      // never the only thing telling gains from losses.
      const color = b.color || (opts.diverging ? (up ? gain : loss) : accent);
      const rr = Math.min(r, h);
      const top = up ? y : base;
      const path = up
        ? `M${cx - r},${base} L${cx - r},${top + rr} Q${cx - r},${top} ${cx - r + rr},${top} L${cx + r - rr},${top} Q${cx + r},${top} ${cx + r},${top + rr} L${cx + r},${base} Z`
        : `M${cx - r},${base} L${cx - r},${base + h - rr} Q${cx - r},${base + h} ${cx - r + rr},${base + h} L${cx + r - rr},${base + h} Q${cx + r},${base + h} ${cx + r},${base + h - rr} L${cx + r},${base} Z`;

      const mark = el('path', { d: h < 0.6 ? `M${cx - r},${base} h${bw}` : path, fill: color });
      mark.style.transition = 'opacity .16s';
      svg.appendChild(mark);

      if (!REDUCED) {
        mark.style.transformOrigin = `${cx}px ${base}px`;
        mark.style.animation = `grow .5s cubic-bezier(.2,.9,.3,1.1) ${Math.min(i * 8, 400)}ms backwards`;
      }

      const hit = el('rect', { x: pad.l + band * i, y: pad.t, width: band, height: ih, fill: 'transparent' });
      hit.addEventListener('pointerenter', () => {
        const rc = svg.getBoundingClientRect();
        mark.style.opacity = '.6';
        tip.show(cx * (rc.width / W), Math.min(y, base) * (rc.height / H),
          b.label, (opts.signed ? signed(b.value) : fmt(b.value)) + (opts.unit || ''));
      });
      hit.addEventListener('pointerleave', () => { mark.style.opacity = '1'; tip.hide(); });
      svg.appendChild(hit);
    });

    const every = Math.max(1, Math.ceil(bars.length / (W < 520 ? 5 : 9)));
    bars.forEach((b, i) => {
      if (i % every !== 0 && i !== bars.length - 1) return;
      const t = el('text', {
        x: pad.l + band * i + band / 2, y: H - 6, fill: 'var(--muted)',
        'font-size': 11.5, 'font-family': 'Lexend, sans-serif', 'text-anchor': 'middle',
      });
      t.textContent = b.short ?? b.label;
      svg.appendChild(t);
    });

    host.querySelectorAll('svg').forEach(s => s.remove());
    host.prepend(svg);
  });
}

// --- heatmap ---------------------------------------------------------------
function heatmap(host, cells, opts = {}) {
  const vals = cells.filter(c => c.value !== null).map(c => c.value);
  if (!vals.length) return emptyState(host, 'Needs about two weeks of hourly snapshots.');
  const tip = mountTip(host);
  const max = Math.max(...vals, 0.0001);
  const min = Math.min(...vals, 0);

  responsive(host, (W) => {
    const gain = opts.mono ? css(host, '--accent') : css(host, '--gain');
    const loss = css(host, '--loss');
    const left = 38, top = 22, gap = 3;
    const cw = (W - left) / 24, ch = 28;
    const H = top + ch * 7 + 8;
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, height: H, role: 'img' });

    for (let h = 0; h < 24; h += 3) {
      const t = el('text', {
        x: left + cw * h + cw / 2, y: 12, fill: 'var(--muted)', 'font-size': 10.5,
        'font-family': 'Lexend, sans-serif', 'text-anchor': 'middle',
      });
      t.textContent = String(h).padStart(2, '0');
      svg.appendChild(t);
    }
    for (let d = 0; d < 7; d++) {
      const t = el('text', {
        x: 0, y: top + ch * d + ch / 2 + 4, fill: 'var(--muted)',
        'font-size': 10.5, 'font-family': 'Lexend, sans-serif',
      });
      t.textContent = dayName[d];
      svg.appendChild(t);
    }

    cells.forEach((c, idx) => {
      const x = left + cw * c.hour, y = top + ch * c.weekday;
      let fill = 'var(--grid)', op = 1;
      if (c.value === null) { fill = 'var(--grid)'; op = .35; }
      else if (c.value > 0) { fill = gain; op = .18 + .82 * (c.value / max); }
      else if (c.value < 0) { fill = loss; op = .18 + .82 * (min ? c.value / min : 0); }

      const rect = el('rect', {
        x: x + gap / 2, y: y + gap / 2, width: Math.max(1, cw - gap), height: ch - gap,
        rx: 8, fill, opacity: op,
      });
      rect.style.transition = 'transform .18s cubic-bezier(.2,.9,.3,1.4)';
      rect.style.transformOrigin = `${x + cw / 2}px ${y + ch / 2}px`;
      rect.addEventListener('pointerenter', () => {
        rect.style.transform = 'scale(1.16)';
        const rc = svg.getBoundingClientRect();
        tip.show((x + cw / 2) * (rc.width / W), y * (rc.height / H),
          `${dayName[c.weekday]} ${hourLabel(c.hour)}`,
          c.value === null ? 'no data'
            : (opts.mono ? fmt(Math.round(c.value)) + (opts.unit || '')
                         : signed(Math.round(c.value * 10) / 10) + ' avg'));
      });
      rect.addEventListener('pointerleave', () => { rect.style.transform = ''; tip.hide(); });
      svg.appendChild(rect);
    });

    host.querySelectorAll('svg').forEach(s => s.remove());
    host.prepend(svg);
  });
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// bar grow keyframe (declared here so the CSS block stays about looks)
const sheet = document.createElement('style');
sheet.textContent = '@keyframes grow { from { transform: scaleY(0); } to { transform: scaleY(1); } }';
document.head.appendChild(sheet);

// ---- theme toggle ---------------------------------------------------------
(function theme() {
  const btn = document.getElementById('theme');
  const get = () => { try { return localStorage.getItem('theme'); } catch { return null; } };
  const set = v => { try { v ? localStorage.setItem('theme', v) : localStorage.removeItem('theme'); } catch {} };
  const apply = v => {
    if (v) document.documentElement.setAttribute('data-theme', v);
    else document.documentElement.removeAttribute('data-theme');
    btn.textContent = v ? (v === 'dark' ? 'Dark' : 'Light') : 'System';
  };
  apply(get());
  btn.addEventListener('click', () => {
    const order = [null, 'light', 'dark'];
    const next = order[(order.indexOf(get()) + 1) % 3];
    set(next); apply(next);
    document.querySelectorAll('.chart').forEach(c => c.dispatchEvent(new Event('themechange')));
    window.dispatchEvent(new Event('resize'));
  });
})();

// --- horizontal bars -------------------------------------------------------
// Channel names are long and human-readable, so they get a horizontal layout
// where the label has room to breathe instead of being rotated or truncated.
function barList(host, items, opts = {}) {
  if (!items || !items.length) { host.innerHTML = `<div class="empty">${opts.empty || 'Nothing to show yet.'}</div>`; return; }
  const max = Math.max(...items.map(i => i.value), 1);
  host.innerHTML = `<div class="hbars">${items.map(i => `
    <div class="hbar" title="${escapeHtml(i.label)}">
      <div class="hbar-name">${escapeHtml(i.label)}</div>
      <div class="hbar-track"><div class="hbar-fill" data-w="${(i.value / max) * 100}"></div></div>
      <div class="hbar-val">${fmt(i.value)}</div>
    </div>`).join('')}</div>`;
  // Widths are applied on the next frame so the bars animate outward.
  requestAnimationFrame(() => {
    host.querySelectorAll('.hbar-fill').forEach(el => {
      el.style.width = (REDUCED ? el.dataset.w : el.dataset.w) + '%';
    });
  });
}

// ---------------------------------------------------------------------------
// Countdown to the next scheduled data collection.
//
// The page is static — it reads the CSVs once, at load. So this both counts
// down to when fresh data lands in the repo AND reloads the page shortly after,
// otherwise you would be staring at an hour-old number with a timer telling you
// it had already updated.
// ---------------------------------------------------------------------------
function startUpdateClock(minuteOffset) {
  const el = document.getElementById('next-update');
  if (!el) return;

  const openedAt = Date.now();
  let reloadedFor = null;

  const tick = () => {
    const now = new Date();
    const last = new Date(now);
    last.setMinutes(minuteOffset, 0, 0);
    if (last > now) last.setHours(last.getHours() - 1);
    const next = new Date(last.getTime() + 3600_000);

    const left = next - now;
    const m = Math.floor(left / 60000);
    const s = Math.floor((left % 60000) / 1000);
    el.textContent = m >= 1 ? `${m}m` : `${s}s`;

    // A job needs a minute or two to run and commit. Once that window has
    // passed, pull the new numbers in — but never on a page just opened, and
    // only once per hour.
    const sinceLast = now - last;
    const hourKey = last.toISOString().slice(0, 13);
    if (sinceLast > 150_000 && sinceLast < 420_000
        && Date.now() - openedAt > 300_000 && reloadedFor !== hourKey) {
      reloadedFor = hourKey;
      el.textContent = 'updating';
      setTimeout(() => location.reload(), 1500);
    }
  };

  tick();
  setInterval(tick, 1000);
}
