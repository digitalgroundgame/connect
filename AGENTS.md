<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## DGG Connect conventions

- UI is shadcn/ui (`base-nova` style, Base UI primitives) on Tailwind CSS 4. Add components with `npx shadcn@latest add <name>`; they land in `src/components/ui`. Theme tokens live in `src/app/globals.css`. DGG blue `#1144FF` is the primary color, and every text color must stay at WCAG AA (4.5:1).
- Use only the official DGG logos in `public/`. Never draw or redraw logo art.
- Database changes: edit `src/db/schema.ts`, then `npm run db:generate -- --name <what>`. Migrations run when the server starts.
- Business logic lives in `src/services` and `src/api` and takes its dependencies as arguments, so it is tested without Next.js. Pages and routes stay thin.
- Never log codes or message text.
- Before pushing: `npm run lint`, `npm run format`, `npm run check-types`, `npm test`.
