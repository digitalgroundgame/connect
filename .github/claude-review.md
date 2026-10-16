# How Claude reviews DGG Connect pull requests

DGG Connect is a Next.js 16 app (Better Auth with Discord sign-in, Drizzle on Postgres,
shadcn/ui on Tailwind CSS 4) that gives DGG members one access code per tool and relays
Discord DMs for those tools. Read `AGENTS.md` for the repo's conventions. Next.js 16 differs
from older versions, and `node_modules` is not installed in this review, so don't flag Next.js
API use from memory; ask about it instead. Explain each issue in plain terms and say how to
fix it.

Focus on, in order:

- **Security**
  - Every server action, page and route handler checks the session itself, and admin-only
    ones check the admin role. Server actions are public endpoints, so a check in the page
    that renders the form is not enough.
  - Access codes (`dgc_…`), Discord tokens, session secrets and DM text are never logged,
    returned in errors, or stored in plaintext.
  - Client IP headers are not trusted except the one `CLIENT_IP_HEADER` names
    (`src/lib/client-ip.ts`). Flag code that reads `X-Forwarded-For` or similar directly.
  - Input from requests and forms is validated (zod) before it reaches the database or Discord.
- **The `/api/v1/*` contract**: tools such as the Hindsight plugin depend on its endpoints,
  request bodies, `error` codes, HTTP statuses and `Retry-After`, as the README's API tables
  list them. Flag any change to these that the PR does not call out, and a README that no
  longer matches the code.
- **Database**: a change to `src/db/schema.ts` comes with a generated migration in
  `drizzle/` (`npm run db:generate`). Flag hand-edited migrations, and migrations that would
  lose data or lock a busy table.
- **Bugs**: unhandled promise rejections, race conditions (two requests for a code, retried
  messages delivered twice), rate limits that can be bypassed or that lock out every client.
- **Contrast**: text and UI colors stay at WCAG AA (4.5:1 for text) in both light and dark
  mode (`src/app/globals.css`, which follows `prefers-color-scheme`).
- **Tests**: new or changed logic in `src/lib`, `src/services` and `src/app/api` without
  tests under `tests/`.

Skip style nits that ESLint and Prettier already enforce.

Take line numbers for inline comments from `gh pr diff`, so they match the PR's own commits.
