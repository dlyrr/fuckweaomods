// Shared auth helpers. Lives outside functions/ so Pages never routes it.

const enc = new TextEncoder();

export const NAME_MAX = 24;
export const NAME_MIN = 2;
export const PASS_MIN = 8;
export const PASS_MAX = 200;
export const SESSION_DAYS = 30;

// ponytail: 100k PBKDF2 rounds is the ceiling the Workers CPU budget allows.
// If you move to a paid plan, raise it; nothing else has to change.
const PBKDF2_ROUNDS = 100000;

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export const randomHex = (bytes = 32) => hex(crypto.getRandomValues(new Uint8Array(bytes)));

export async function hashPassword(password, saltHex) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(saltHex), iterations: PBKDF2_ROUNDS },
    key,
    256
  );
  return hex(bits);
}

export async function sha256Hex(s) {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
}

// constant time: never let response latency leak how much of the hash matched
export function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Usernames: letters, digits, underscore, dash, dot. No spaces, no lookalike padding.
const NAME_RE = /^[a-zA-Z0-9._-]+$/;

export function validateCredentials(input) {
  if (!input || typeof input !== 'object') return { error: 'malformed body', status: 400 };

  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const password = typeof input.password === 'string' ? input.password : '';

  if (name.length < NAME_MIN) return { error: 'name needs ' + NAME_MIN + '+ characters', status: 400 };
  if (name.length > NAME_MAX) return { error: 'name over ' + NAME_MAX + ' characters', status: 400 };
  if (!NAME_RE.test(name)) return { error: 'name: letters, digits, . _ - only', status: 400 };
  if (password.length < PASS_MIN) return { error: 'password needs ' + PASS_MIN + '+ characters', status: 400 };
  if (password.length > PASS_MAX) return { error: 'password over ' + PASS_MAX + ' characters', status: 400 };

  return { name, password, nameLower: name.toLowerCase() };
}

export function readCookie(request, key) {
  const raw = request.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === key) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export const COOKIE = 'sid';

export const sessionCookie = (token) =>
  COOKIE + '=' + token + '; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=' + SESSION_DAYS * 86400;

export const clearCookie = () => COOKIE + '=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0';

// Returns { id, name } or null. Expired sessions are treated as absent.
export async function currentUser(request, env) {
  const token = readCookie(request, COOKIE);
  if (!token) return null;
  const row = await env.DB.prepare(
    'SELECT u.id AS id, u.name AS name, s.expires_at AS expires_at' +
      ' FROM sessions s JOIN users u ON u.id = s.user_id' +
      ' WHERE s.token_hash = ?'
  )
    .bind(await sha256Hex(token))
    .first();
  if (!row || row.expires_at < Date.now()) return null;
  return { id: row.id, name: row.name };
}

export async function startSession(env, userId) {
  const token = randomHex(32);
  const now = Date.now();
  await env.DB.prepare(
    'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
  )
    .bind(await sha256Hex(token), userId, now, now + SESSION_DAYS * 86400000)
    .run();
  return token;
}
