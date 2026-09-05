// Pages Function: /api/comments
// GET  ?before=<cursor>&limit=50  -> newest first, keyset pagination, public
// POST { body, hp }               -> requires a logged in account

import { currentUser, sha256Hex } from '../../lib/auth.js';

// --- configurable word filter -------------------------------------------
// Lowercase substrings. Anything matched is rejected outright.
const BLOCKED = [
  // add slurs / banned terms here, lowercase, no punctuation
];
// ------------------------------------------------------------------------

const BODY_MAX = 500;
const PAGE_MAX = 50;
const RATE_MS = 30000;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });

// Strip tags, then stray angle brackets, then control chars and runaway whitespace.
export const stripHtml = (s) =>
  s
    .replace(/<[^>]*>/g, '')
    .replace(/[<>]/g, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

export const isBlocked = (text) => {
  const t = text.toLowerCase();
  return BLOCKED.some((w) => w && t.includes(w));
};

// Returns { body } on success, { error, status } on failure.
// The display name comes from the session, never from the payload.
export function validate(input) {
  if (!input || typeof input !== 'object') return { error: 'malformed body', status: 400 };
  // honeypot: real browsers leave it empty
  if (typeof input.hp === 'string' && input.hp.trim() !== '') return { error: 'no', status: 400 };

  const body = stripHtml(typeof input.body === 'string' ? input.body : '');

  if (!body) return { error: 'say something', status: 400 };
  if (body.length > BODY_MAX) return { error: 'keep it under ' + BODY_MAX + ' chars', status: 400 };
  if (isBlocked(body)) return { error: 'filtered', status: 400 };

  return { body };
}

// cursor is "<created_at>_<id>" so identical timestamps never drop a row
export const encodeCursor = (row) => row.created_at + '_' + row.id;

export function decodeCursor(raw) {
  if (!raw) return null;
  const i = raw.indexOf('_');
  if (i < 1) return null;
  const ts = Number(raw.slice(0, i));
  const id = raw.slice(i + 1);
  if (!Number.isFinite(ts) || !id) return null;
  return { ts, id };
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const asked = parseInt(url.searchParams.get('limit') || '50', 10);
  const limit = Math.min(Math.max(Number.isFinite(asked) ? asked : 50, 1), PAGE_MAX);
  const cursor = decodeCursor(url.searchParams.get('before'));

  const stmt = cursor
    ? env.DB.prepare(
        'SELECT id, name, body, created_at FROM comments' +
          ' WHERE created_at < ?1 OR (created_at = ?1 AND id < ?2)' +
          ' ORDER BY created_at DESC, id DESC LIMIT ?3'
      ).bind(cursor.ts, cursor.id, limit + 1)
    : env.DB.prepare(
        'SELECT id, name, body, created_at FROM comments' +
          ' ORDER BY created_at DESC, id DESC LIMIT ?1'
      ).bind(limit + 1);

  try {
    const { results } = await stmt.all();
    const hasMore = results.length > limit;
    const page = hasMore ? results.slice(0, limit) : results;
    return json({
      comments: page,
      cursor: hasMore ? encodeCursor(page[page.length - 1]) : null,
    });
  } catch {
    return json({ error: 'the database is about as reliable as the mods' }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  if (!env.IP_SALT) return json({ error: 'server misconfigured: no IP_SALT' }, 500);

  let user;
  try {
    user = await currentUser(request, env);
  } catch {
    return json({ error: 'the database is about as reliable as the mods' }, 500);
  }
  if (!user) return json({ error: 'log in first' }, 401);

  let input;
  try {
    input = await request.json();
  } catch {
    return json({ error: 'malformed body' }, 400);
  }

  const v = validate(input);
  if (v.error) return json({ error: v.error }, v.status);

  const ip = request.headers.get('CF-Connecting-IP') || '0.0.0.0';
  const ipHash = await sha256Hex(env.IP_SALT + ':' + ip);
  const now = Date.now();

  try {
    const last = await env.DB.prepare(
      'SELECT created_at FROM comments WHERE ip_hash = ? ORDER BY created_at DESC LIMIT 1'
    )
      .bind(ipHash)
      .first();

    if (last && now - last.created_at < RATE_MS) {
      const wait = Math.ceil((RATE_MS - (now - last.created_at)) / 1000);
      return json({ error: 'slow down. ' + wait + 's', retry_after: wait }, 429);
    }

    const row = { id: crypto.randomUUID(), name: user.name, body: v.body, created_at: now };
    await env.DB.prepare(
      'INSERT INTO comments (id, name, body, created_at, ip_hash) VALUES (?, ?, ?, ?, ?)'
    )
      .bind(row.id, row.name, row.body, row.created_at, ipHash)
      .run();

    return json(row, 201);
  } catch {
    return json({ error: 'the database is about as reliable as the mods' }, 500);
  }
}
