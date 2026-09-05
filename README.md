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
│       └── comments.js GET + POST /api/comments
├── schema.sql          D1 tables and indexes
├── wrangler.toml       D1 binding, Pages output dir
├── test.mjs            self-check for validation + cursor logic
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

```json
{ "name": "anon", "body": "text", "hp": "" }
```

Returns `201` with the created row. `hp` is the honeypot and must be empty.

| Status | Meaning |
|--------|---------|
| `400` | empty body, over length, honeypot filled, or word-filtered |
| `429` | rate limited, `retry_after` in seconds |
| `500` | `IP_SALT` unset or D1 failed |

## Behaviour worth knowing

- **Validation is server side.** The client checks too, but the function re-trims, re-strips HTML and re-checks lengths on every request. `name` max 24, `body` max 500.
- **A blank name becomes `anon`** rather than an error. Change that in `validate()` if you'd rather reject it.
- **Rate limit: 1 comment per IP hash per 30 seconds**, enforced by reading the most recent row for that hash. Tune `RATE_MS` at the top of `functions/api/comments.js`.
- **IPs are never stored.** `CF-Connecting-IP` is hashed as `SHA-256(IP_SALT + ":" + ip)`. Rotate `IP_SALT` and every existing hash becomes unlinkable.
- **Word filter** is the `BLOCKED` array at the top of the function. Lowercase substrings, empty by default.
- **No `innerHTML` anywhere.** Comments render through `textContent` and a `<template>`, so stored markup can't execute even if something got past the server.

## Not included

Deletion, moderation, editing, and accounts. Skipped on purpose. If the wall gets bad enough
to need them, add a `DELETE /api/comments/:id` behind a secret header before you add a login system.
