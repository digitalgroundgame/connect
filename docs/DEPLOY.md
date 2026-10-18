# Deploying Digital Ground Game Connect

Digital Ground Game Connect runs as one Docker container next to a Postgres database on
Coolify, behind the Cloudflare proxy like every digitalgroundgame.org
subdomain.

## 1. Database

Create a Postgres database in Coolify (version 18, the version CI tests against) and copy its
internal connection URL. The app creates and updates its own tables when it
starts.

## 2. Discord

In the Discord Developer Portal, open the existing Digital Ground Game app (the one the Digital Ground Game bot
uses):

1. **OAuth2 > Redirects**: add `https://<host>/api/auth/callback/discord`.
2. Copy the **Client ID** and **Client Secret** from OAuth2, and the bot token
   the Digital Ground Game bot already uses.
3. Enable Developer Mode in Discord, then right-click the Digital Ground Game server to copy its
   ID.

Sign-in asks Discord only for the `identify` scope. The bot checks server
membership and sends DMs, so it must stay in the Digital Ground Game server.

## 3. Application

Add an application in Coolify from this repository with the **Dockerfile**
build pack, port **3000**, and the domain `https://<host>`. The image has a
HEALTHCHECK on `/api/health`, which also checks the database, so Coolify waits
for it before switching traffic. Set these
environment variables (see `.env.example` for details):

| Variable                | Value                                |
| ----------------------- | ------------------------------------ |
| `DATABASE_URL`          | The database URL from step 1.        |
| `BETTER_AUTH_URL`       | `https://<host>`                     |
| `BETTER_AUTH_SECRET`    | Output of `openssl rand -base64 32`. |
| `DISCORD_CLIENT_ID`     | From step 2.                         |
| `DISCORD_CLIENT_SECRET` | From step 2.                         |
| `DISCORD_BOT_TOKEN`     | From step 2.                         |
| `DISCORD_GUILD_ID`      | The Digital Ground Game server ID.   |
| `CLIENT_IP_HEADER`      | `cf-connecting-ip`                   |

`CLIENT_IP_HEADER` must only be set when Cloudflare is in front: the header
decides whose rate limit a request counts against, and anyone can send it
when there is no proxy to overwrite it.

## 4. Cloudflare

Add a proxied DNS record for the host pointing at the Coolify server. Use SSL
mode **Full (strict)**.

## 5. First admin

Admins are stored in the database. Once someone is an admin, they make others
admins from the member list at `/admin`. The first one is set by hand, once:

1. Open `https://<host>` and sign in with Discord.
2. In Coolify, open the database's **Terminal** and run `psql -U <user> <database>`
   (the user and database from its connection URL).
3. Run, with your Discord user ID (Discord Developer Mode, right-click your
   profile, **Copy User ID**):

   ```sql
   UPDATE "user" SET role = 'admin' WHERE discord_id = '<your Discord user ID>';
   ```

   It should print `UPDATE 1`. `UPDATE 0` means that account has not signed in yet.

4. Reload the site. An **Admin** button appears next to **Sign out**.

## 6. First project

At `/admin`, add the Hindsight project with the slug `hindsight` and "Can send
Discord DMs to members" turned on.
