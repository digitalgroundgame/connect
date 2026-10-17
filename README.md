# DGG Connect

Sign in with Discord to get access codes for Digital Ground Game tools, like
the Hindsight OBS plugin. Tools use their code to reach DGG services, such as
Discord DMs from the DGG bot.

- Members of the DGG Discord server sign in with Discord and get one code per
  tool ("project"). Getting a new code turns the old one off.
- Admins add and edit projects at `/admin`, turn off any member's code, and
  make other members admins.
- Tools send `Authorization: Bearer <code>` to the API below. A project that
  is allowed to DM can have the DGG bot send the member a Discord message.

Built with Next.js 16, Better Auth, Drizzle ORM on Postgres, and shadcn/ui on
Tailwind CSS 4. Deployed as a Docker image on Coolify; see
[docs/DEPLOY.md](docs/DEPLOY.md).

## API

All endpoints take `Authorization: Bearer dgc_…` and answer JSON. Errors look
like `{ "ok": false, "error": "rate_limited", "message": "…" }`. `message` is
written for the member, so tools can show it as it is. 429 answers carry
`Retry-After` in seconds.

| Endpoint                | Body                            | Does                                     |
| ----------------------- | ------------------------------- | ---------------------------------------- |
| `POST /api/v1/test`     | none                            | Sends the member a fixed test DM.        |
| `POST /api/v1/messages` | `{ "content": "…", "id": "…" }` | Sends `content` (up to 1800 characters). |

`id` is optional, up to 64 characters: the tool's own ID for the message. A
retry with the same `id` and content is not delivered twice. Every DM ends with
a line naming the tool it came from. Success is
`{ "ok": true, "project": "<slug>", "discordName": "<name>" }`.

| `error`               | Status | Meaning                                        |
| --------------------- | ------ | ---------------------------------------------- |
| `invalid_request`     | 400    | The body is not what the endpoint expects.     |
| `invalid_code`        | 401    | Missing, unknown or turned-off code.           |
| `project_disabled`    | 403    | The project is turned off.                     |
| `dm_not_allowed`      | 403    | The project may not send DMs.                  |
| `dm_closed`           | 409    | The member's Discord settings block bot DMs.   |
| `too_large`           | 413    | The content or body is too long.               |
| `rate_limited`        | 429    | Too many messages; wait `Retry-After` seconds. |
| `discord_unavailable` | 502    | Discord did not take the message.              |
| `server_error`        | 500    | Something broke on our side.                   |

## Development

Needs Node 24 and Postgres.

```sh
npm install
cp .env.example .env.local   # then fill it in
npm run dev                  # http://localhost:3000, migrations run on start
```

For sign-in to work locally, add `http://localhost:3000/api/auth/callback/discord`
as a redirect on the Discord app. To reach `/admin`, sign in once, then make
yourself an admin as in [docs/DEPLOY.md](docs/DEPLOY.md#5-first-admin).

| Script                  | Does                                             |
| ----------------------- | ------------------------------------------------ |
| `npm test`              | Vitest. Database tests need `TEST_DATABASE_URL`. |
| `npm run test:coverage` | The same, with a coverage report.                |
| `npm run lint`          | ESLint.                                          |
| `npm run format`        | Prettier check (`format:fix` to rewrite).        |
| `npm run check-types`   | TypeScript, with Next.js route types.            |
| `npm run db:generate`   | A new migration from `src/db/schema.ts`.         |
