# fuckweaomods.xyz

A single-page vent site with a live comment wall. Cloudflare Pages + a Pages Function + D1.
No framework, no build step, no `node_modules`.

## Files

```
.
├── public/
│   ├── index.html      hero, manifesto, comment wall
│   ├── style.css       dark theme, animated gradient + grain
│   └── app.js          fetch, render (textContent only), cursor pagination
├── functions/
│   └── api/
│       ├── comments.js       GET + POST /api/comments
│       └── auth/
│           └── [action].js   register / login / logout / me
├── lib/
│   └── auth.js         password hashing, sessions, cookies
├── schema.sql          D1 tables and indexes
├── wrangler.toml       D1 binding, Pages output dir
├── test.mjs            self-check for validation, cursor and credential logic
└── package.json        scripts only, zero dependencies
```

## Setup

You need `wrangler` (`npm i -g wrangler`, or use `npx wrangler`) and a Cloudflare account.

**1. Create the database**

```bash
wrangler d1 create fuckweaomods
```

Copy the printed `database_id` into `wrangler.toml`, replacing the zeros.

**2. Apply the schema**

```bash
wrangler d1 execute fuckweaomods --remote --file=./schema.sql
```

For local dev, run the same command with `--local` instead of `--remote`.

**3. Create the Pages project**

```bash
wrangler pages project create fuckweaomods --production-branch main
```

**4. Set the IP salt**

The salt is what makes the stored hashes useless to anyone who steals the database.
Generate a long random one and never commit it.

```bash
# production secret
wrangler pages secret put IP_SALT --project-name fuckweaomods
# paste something like: openssl rand -hex 32
```

For local dev, put it in `.dev.vars` (already gitignored):

```
IP_SALT=some-long-random-local-value
```

**5. Deploy**

```bash
wrangler pages deploy
```

Then attach `fuckweaomods.xyz` to the Pages project under
**Workers & Pages → fuckweaomods → Custom domains**.

## Local dev

```bash
wrangler pages dev
```

Serves `public/`, runs the function, and uses a local D1 instance.

## Test

```bash
node test.mjs
```

Asserts the HTML stripping, length caps, honeypot, and cursor round-trip. Exits non-zero on failure.

## API

### `GET /api/comments?before=<cursor>&limit=50`

Newest first. `limit` is clamped to 1..50.

```json
{
  "comments": [
    { "id": "uuid", "name": "anon", "body": "text", "created_at": 1757000000000 }
  ],
  "cursor": "1757000000000_uuid"
}
```

`cursor` is `null` when there are no more rows. Pass it back as `before` for the next page.
It is a keyset cursor (`created_at` + `id`), so rows written in the same millisecond are never skipped.

### `POST /api/comments`

Requires a session cookie. The display name comes from the account, never from the payload.

```json
{ "body": "text", "hp": "" }
```

Returns `201` with the created row. `hp` is the honeypot and must be empty.

| Status | Meaning |
|--------|---------|
| `400` | empty body, over length, honeypot filled, or word-filtered |
| `401` | not logged in, or the session expired |
| `429` | rate limited, `retry_after` in seconds |
| `500` | `IP_SALT` unset or D1 failed |

### `POST /api/auth/register`

```json
{ "name": "mod_hater", "password": "at least 8 chars" }
```

Returns `201` with `{ "name": ... }` and sets the session cookie. Names are 2 to 24 characters
of letters, digits, `.`, `_` and `-`, and are unique case-insensitively.

| Status | Meaning |
|--------|---------|
| `400` | name or password fails the rules |
| `409` | name is taken |
| `429` | more than 3 accounts from one IP hash in an hour |

### `POST /api/auth/login`

Same body. Returns `200` with `{ "name": ... }` and sets the cookie. A wrong password and an
unknown name both return `401` with identical text and cost the same time, so neither leaks
whether an account exists.

### `POST /api/auth/logout`

Deletes the session row and clears the cookie. Always `200`.

### `GET /api/auth/me`

Returns `{ "user": { "id", "name" } }`, or `{ "user": null }` when logged out.

## Behaviour worth knowing

- **You need an account to post.** Reading the wall is public; `POST /api/comments` is not.
  The session cookie is `HttpOnly`, `Secure`, `SameSite=Lax`, and lasts 30 days.
- **Passwords are PBKDF2-SHA256, 100,000 rounds, 16 random bytes of salt per user.** No
  dependency, just WebCrypto. `PBKDF2_ROUNDS` in `lib/auth.js` is capped by the Workers CPU
  budget on the free plan; raise it on a paid plan and nothing else has to change.
- **Session tokens are stored hashed.** The database holds `SHA-256(token)`, so a database leak
  does not hand anyone a working cookie.
- **Validation is server side.** The client checks too, but the function re-trims, re-strips HTML and re-checks lengths on every request. `body` max 500.
- **The display name is taken from the session**, so a crafted payload cannot post under someone else's name.
- **Rate limit: 1 comment per IP hash per 30 seconds**, enforced by reading the most recent row for that hash. Tune `RATE_MS` at the top of `functions/api/comments.js`.
- **IPs are never stored.** `CF-Connecting-IP` is hashed as `SHA-256(IP_SALT + ":" + ip)`. Rotate `IP_SALT` and every existing hash becomes unlinkable.
- **Word filter** is the `BLOCKED` array at the top of the function. Lowercase substrings, empty by default.
- **No `innerHTML` anywhere.** Comments render through `textContent` and a `<template>`, so stored markup can't execute even if something got past the server.

## Not included

Password reset, email, deletion, editing and moderation. Skipped on purpose. There is no email
address on file, so a forgotten password means a new account. If the wall gets bad enough to
need moderation, add a `DELETE /api/comments/:id` behind a secret header before anything larger.

Expired sessions are ignored at read time but never swept from the table. Add a scheduled
`DELETE FROM sessions WHERE expires_at < ?` if the row count ever matters.
