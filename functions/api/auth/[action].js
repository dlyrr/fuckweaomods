// /api/auth/register | /api/auth/login | /api/auth/logout | /api/auth/me
import {
  validateCredentials,
  hashPassword,
  randomHex,
  sha256Hex,
  timingSafeEqual,
  currentUser,
  startSession,
  sessionCookie,
  clearCookie,
  readCookie,
  COOKIE,
} from '../../../lib/auth.js';

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
  });

// 3 new accounts per IP hash per hour. Signup is the cheap thing to abuse.
const SIGNUP_WINDOW_MS = 3600000;
const SIGNUP_MAX = 3;

async function ipHash(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || '0.0.0.0';
  return sha256Hex(env.IP_SALT + ':' + ip);
}

async function body(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export async function onRequestPost(ctx) {
  const { request, env, params } = ctx;
  const action = params.action;

  if (action === 'logout') {
    const token = readCookie(request, COOKIE);
    if (token) {
      await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256Hex(token)).run();
    }
    return json({ ok: true }, 200, { 'set-cookie': clearCookie() });
  }

  if (action !== 'register' && action !== 'login') return json({ error: 'not found' }, 404);
  if (!env.IP_SALT) return json({ error: 'server misconfigured: no IP_SALT' }, 500);

  const v = validateCredentials(await body(request));
  if (v.error) return json({ error: v.error }, v.status);

  try {
    if (action === 'register') {
      const hash = await ipHash(request, env);
      const recent = await env.DB.prepare(
        'SELECT COUNT(*) AS n FROM users WHERE ip_hash = ? AND created_at > ?'
      )
        .bind(hash, Date.now() - SIGNUP_WINDOW_MS)
        .first();
      if (recent && recent.n >= SIGNUP_MAX) {
        return json({ error: 'too many accounts from here. try in an hour' }, 429);
      }

      const taken = await env.DB.prepare('SELECT 1 FROM users WHERE name_lower = ?')
        .bind(v.nameLower)
        .first();
      if (taken) return json({ error: 'name is taken' }, 409);

      const salt = randomHex(16);
      const id = crypto.randomUUID();
      await env.DB.prepare(
        'INSERT INTO users (id, name, name_lower, pass_hash, salt, created_at, ip_hash)' +
          ' VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
        .bind(id, v.name, v.nameLower, await hashPassword(v.password, salt), salt, Date.now(), hash)
        .run();

      const token = await startSession(env, id);
      return json({ name: v.name }, 201, { 'set-cookie': sessionCookie(token) });
    }

    // login
    const user = await env.DB.prepare('SELECT id, name, pass_hash, salt FROM users WHERE name_lower = ?')
      .bind(v.nameLower)
      .first();

    // Hash regardless so a missing user and a wrong password cost the same.
    const attempt = await hashPassword(v.password, user ? user.salt : randomHex(16));
    if (!user || !timingSafeEqual(attempt, user.pass_hash)) {
      return json({ error: 'wrong name or password' }, 401);
    }

    const token = await startSession(env, user.id);
    return json({ name: user.name }, 200, { 'set-cookie': sessionCookie(token) });
  } catch {
    return json({ error: 'the database is about as reliable as the mods' }, 500);
  }
}

export async function onRequestGet({ request, env, params }) {
  if (params.action !== 'me') return json({ error: 'not found' }, 404);
  try {
    return json({ user: await currentUser(request, env) });
  } catch {
    return json({ user: null });
  }
}
