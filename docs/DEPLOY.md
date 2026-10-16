# Deploying DGG Connect

DGG Connect runs as one Docker container next to a Postgres database on
Coolify, behind the Cloudflare proxy like every digitalgroundgame.org
subdomain.

## 1. Database

Create a Postgres database in Coolify (version 16 or newer) and copy its
internal connection URL. The app creates and updates its own tables when it
starts.

## 2. Discord

In the Discord Developer Portal, open the existing DGG app (the one the DGG bot
uses):

1. **OAuth2 > Redirects**: add `https://<host>/api/auth/callback/discord`.
2. Copy the **Client ID** and **Client Secret** from OAuth2, and the bot token
   the DGG bot already uses.
3. Enable Developer Mode in Discord, then right-click the DGG server to copy its
   ID, and your own profile to copy your user ID for `ADMIN_DISCORD_IDS`.

Sign-in asks Discord only for the `identify` scope. The bot checks server
membership and sends DMs, so it must stay in the DGG server.

## 3. Application

Add an application in Coolify from this repository with the **Dockerfile**
build pack, port **3000**, and the domain `https://<host>`. The image has a
HEALTHCHECK on `/api/health`, which also checks the database, so Coolify waits
for it before switching traffic. Set these
environment variables (see `.env.example` for details):

| Variable                | Value                                   |
| ----------------------- | --------------------------------------- |
| `DATABASE_URL`          | The database URL from step 1.           |
| `BETTER_AUTH_URL`       | `https://<host>`                        |
| `BETTER_AUTH_SECRET`    | Output of `openssl rand -base64 32`.    |
| `DISCORD_CLIENT_ID`     | From step 2.                            |
| `DISCORD_CLIENT_SECRET` | From step 2.                            |
| `DISCORD_BOT_TOKEN`     | From step 2.                            |
| `DISCORD_GUILD_ID`      | The DGG server ID.                      |
| `ADMIN_DISCORD_IDS`     | Comma-separated admin Discord user IDs. |
| `CLIENT_IP_HEADER`      | `cf-connecting-ip`                      |

`CLIENT_IP_HEADER` must only be set when Cloudflare is in front: the header
decides whose rate limit a request counts against, and anyone can send it
when there is no proxy to overwrite it.

## 4. Cloudflare

Add a proxied DNS record for the host pointing at the Coolify server. Use SSL
mode **Full (strict)**.

## 5. First run

Open `https://<host>`, sign in with an admin account, and add the Hindsight
project at `/admin` with the slug `hindsight` and "Can send Discord DMs"
turned on.
