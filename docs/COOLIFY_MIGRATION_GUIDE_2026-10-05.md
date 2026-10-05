# WhatsApp automation: Windows to the verified Coolify Linux server

Prepared 5 October 2026 (Asia/Karachi) for `D:\AI-Automation`.

**Latest user-provided evidence:** the selected Coolify server reports Ubuntu 24.04.5 LTS, `uname -m=x86_64`, and Docker `OS=linux ARCH=x86_64`. Use Linux AMD64 images for this target. Its relationship to the Apple Silicon Mac mini is not established; do not infer the deployment architecture from the Mac hardware. The application screenshots show **No deployments found**, **No deployed container found**, Docker network `coolify`, and exposed port `3000`. There is no deployment failure log to diagnose yet. The Build pipeline/source configuration still needs inspection before the first deployment. The hosted n8n screenshot shows its workflow editor, and the resource list shows n8n Running; functional execution remains unverified.

This is a deployment and migration runbook. No server configuration, workflow, database, DNS record, or running application was changed while preparing it.

**Answer about Docker Desktop and pgAdmin:** start Docker Desktop on Windows for local inventory, export, and testing. After successful migration, Windows Docker Desktop and Windows PostgreSQL are no longer production dependencies. pgAdmin is a database administration client; it does not have to remain open. The Mac mini, its Linux environment, Docker Engine, network connection, and application containers must remain running.

**1. What was checked and what remains unknown**

| Item | Observed result |
|---|---|
| Deployment environment | User-provided server output confirms Ubuntu 24.04.5 LTS with Linux x86-64 Docker. Physical host identity remains unconfirmed. |
| Windows PostgreSQL | `postgresql-x64-18` service is running. |
| Local Docker | The Docker API pipe was unavailable; a Docker configuration access warning also occurred. Current container health could not be verified. |
| Coolify URL | Cloudflare Access login page. Deployment status is not verified. |
| Hosted n8n URL | n8n sign-in page. Workflow contents, version, publication status, and host are not verified. |
| Local application | A multi-service n8n/Evolution/PostgreSQL/Redis system. Root `index.js` is empty. |
| Local workflow export | Contains database calls, Redis deduplication, Groq, and Evolution response routing. It has local host references and imports `pg`, `ioredis`, and `axios`. |
| Saved repair evidence | The October 1 audit records unfinished readiness checks. These are historical findings, not proof of today's failure or success. |

The supplied YouTube tutorial demonstrates one Express application deployed from a Dockerfile. Its Git-to-Coolify process is useful, but your project needs multiple services, persistent storage, database migration, and workflow configuration. Do not create an Express application merely to imitate the video.

**2. Establish the target before creating resources**

For the currently selected server, use its verified Ubuntu x86-64 environment and Linux AMD64 images. If moving later to a native ARM64 Linux VM on the Apple Silicon Mac, repeat architecture and image compatibility checks for that new target. Retain the existing Coolify installation; no reinstall is needed for this application deployment.

In Coolify, inspect **Servers** and confirm the deployment server is the intended Mac mini Linux environment. A working dashboard domain does not identify the physical machine behind it.

Run these read-only commands in that Linux server's terminal:

```bash
uname -m
cat /etc/os-release
docker version
docker compose version
free -h
df -h
```

Verified target architecture: `x86_64`/AMD64. A planning starting point for this stack is 4 CPUs, 8 GB RAM, and 60–100 GB persistent disk, subject to workload and available host memory. This is a sizing estimate, not a measured requirement. Configure automatic server/service startup after reboot and off-machine backups; prevent host sleep if this is a locally hosted VM.

Coolify supports Linux and amd64/arm64; its own minimum hardware requirements do not include the needs of your full application. [Coolify installation requirements](https://coolify.io/docs/start-with-self-hosted)

Choose the n8n source of truth:

- If `n8n.glimstechai.com` already contains the current workflow and runs on the intended server, reuse it. Deploy only missing services and connect them privately. Do not replace its database or encryption key.
- If it is an empty/test installation, or the current workflow exists only locally, create a separate migration resource and restore into that. Keep the existing resource until validation passes.
- If it runs on another server, either keep it and provide private inter-server connectivity, or deliberately migrate it. Docker service names do not resolve between independent servers.

The supplied hosted workflow ID differs from the workflow ID in the local repair notes. Export the current authoritative workflow from its actual n8n instance; do not assume the repository JSON is current.

**3. Inventory and back up the local system**

Start Docker Desktop and wait for the Linux engine to become ready. In Windows PowerShell:

```powershell
Set-Location 'D:\AI-Automation'
docker version
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
docker volume ls
```

Use actual container names from the output. The local configuration expects `n8n`, `evolution-go`, and `evolution-redis`, but the running inventory must confirm them. Do not start all legacy Compose definitions: the folder contains overlapping alternatives.

Record image versions, volume mounts, n8n database backend, database names/extensions, instance names, callback URLs, and secrets in a private inventory. Do not paste full environment dumps into chat or Git.

```powershell
docker exec n8n n8n --version
docker inspect n8n --format '{{json .Mounts}}'
docker inspect evolution-go --format '{{json .Mounts}}'
docker inspect evolution-redis --format '{{json .Mounts}}'
```

Create a fresh backup directory. Export the current workflow through n8n's download menu and back up credentials securely. Workflow JSON alone does not contain a complete working credential backup.

For full local n8n migration, preserve `/home/node/.n8n`, the exact encryption key, custom/community nodes, and binary storage. The local Compose configuration appears to use SQLite; verify the actual runtime. A filesystem copy of a running SQLite database is not a reliable consistent backup: stop n8n for the copy or use SQLite's supported online backup mechanism. Do not copy a SQLite file into PostgreSQL and expect it to migrate.

Use pgAdmin's Query Tool on the actual PostgreSQL 18 source:

```sql
SELECT version();
SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname;
SELECT extname, extversion FROM pg_extension ORDER BY extname;
```

Run the extension query separately in every application database. Expected names to confirm include `evogo_auth`, `evogo_users`, `platform_db`, `pos_db`, `bise_db`, and `hospital_db`; include any additional CRM/knowledge databases actually in use.

In pgAdmin: right-click each database → **Backup** → **Custom** format → select a dated destination. Preserve schema and data. Record database ownership and role grants separately.

Equivalent PowerShell example, after confirming the installation path and creating the destination directory:

```powershell
$migrationBackup = 'D:\AI-Automation\backups\coolify-migration-20261005'
New-Item -ItemType Directory -Force -Path $migrationBackup | Out-Null
& 'C:\Program Files\PostgreSQL\18\bin\pg_dump.exe' -h localhost -p 5432 -U postgres -W -Fc -f "$migrationBackup\platform_db.dump" platform_db
& 'C:\Program Files\PostgreSQL\18\bin\pg_restore.exe' --list "$migrationBackup\platform_db.dump"
```

Repeat for every required database, and check every command succeeds. Back up role definitions with `pg_dumpall --roles-only` when preserving existing ownership/grants; this output is sensitive and must be reviewed before restoring into another cluster. Listing a dump verifies its readability, not successful restoration.

Back up Evolution volumes and both Evolution databases. Back up Redis consistently if its session/deduplication state must survive. Take a final consistent backup during the cutover write pause: independently captured live databases may represent different instants.

Existing DPAPI-encrypted backups are tied to the Windows identity/key material. Prepare and verify a portable encrypted transfer; the Linux server cannot directly restore a Windows DPAPI blob.

**4. Resolve image and workflow compatibility before deployment**

Pin the current working application versions for migration. Handle upgrades separately after restore succeeds. Both the Windows Docker environment and selected Coolify server report x86-64; still verify the selected image references are available for Linux AMD64.

For each candidate image, run on a machine with registry access:

```bash
docker buildx imagetools inspect IMAGE:VERSION
```

Replace `IMAGE:VERSION` with the real reference. Check for `linux/amd64`, including Evolution GO, n8n, PostgreSQL/pgvector, Redis, and any runner image. ARM64 support is only a prerequisite if you later select an ARM64 deployment server.

If a required image is unavailable for the actual target architecture, build its matching source revision for that architecture and test it before publishing to your private registry. The local `evolution-go/Dockerfile` is a build starting point, not a verified replacement for the deployed image. Its `.dockerignore` currently needs a secrets review before any build or upload; a broad `COPY . .` can include `.env` files in build stages/cache.

The workflow imports custom modules and some absolute paths inside the n8n installation. `NODE_FUNCTION_ALLOW_EXTERNAL=pg,ioredis,axios` only permits imports; it does not install packages. Make the modules available in the runtime actually executing each Code/tool node. If using external task runners, the matching runner image and its allowlist need the dependencies too. Verify by executing the affected nodes, not just opening the editor. Prefer supported native Postgres/HTTP/Redis nodes where practical; do not make a large workflow rewrite a prerequisite unless tests show it is needed.

**5. Prepare the Coolify configuration**

Use a new migration resource while the current resource remains intact. Two supported routes:

- **Docker Compose Empty:** paste a self-contained image-based Compose definition. Local build folders and SQL files on `D:` are not automatically available on the server.
- **Private Git repository + Docker Compose build pack:** keep a reviewed `docker-compose.coolify.yml` and required non-secret build/config files in a clean deployment repository. Set Base Directory to the repository root and Compose Location to that file.

Do not upload this whole workspace without review. Existing Compose/config files and workflow code contain embedded secrets, and the current `.gitignore` is not a complete secret exclusion policy. Exclude backups, session data, database exports, `.env` files, customer data, and diagnostic artifacts. Removing a secret from the current file does not remove it from Git history. Rotate exposed API/database credentials and update callers. Preserve the n8n encryption key during migration; changing it casually can make credentials unreadable.

Create the deployment Compose with these requirements:

| Service | Configuration |
|---|---|
| Evolution GO | AMD64-tested pinned image; internal port 4000; persistent `/app/dbdata` and `/app/logs`; DB URLs for `evogo_auth` and `evogo_users`; global `WEBHOOK_URL` empty; `CONNECT_ON_STARTUP=false` during restore. |
| PostgreSQL | PostgreSQL 18, with required extensions including pgvector where used; private port 5432; persistent volume; health check. |
| Redis | Pinned tested image; persistent `/data`; AOF as in the local setup; private port 6379; authentication reflected in workflow clients; health check. |
| n8n, only if moving it | Current tested version; internal port 5678; persistent `/home/node/.n8n`; original encryption key for restored encrypted credentials; matching module/runner setup. |

Do not carry over the separate Nginx container from `docker-compose.prod.yml`: let the existing Coolify proxy handle web routing and TLS. Remove fixed `container_name` values, Windows paths, external volume names referring to the PC, and host mappings for database/cache ports. New named volumes start empty; they do not transfer old data.

Your older production Compose uses PostgreSQL 15 and SQL scripts that do not by themselves reproduce the complete multi-database source. Keep the destination on PostgreSQL 18 for this migration. The platform SQL requires `vector`, so plain Postgres without that extension may fail. pgvector publishes PostgreSQL 18 variants; verify the exact image architecture and extension compatibility before use. [pgvector Docker instructions](https://github.com/pgvector/pgvector#docker)

For official-image-based PostgreSQL 18, mount persistent storage at `/var/lib/postgresql` (default PGDATA is `/var/lib/postgresql/18/docker`). Confirm this against the chosen image. Do not reuse the PostgreSQL 15 mount assumptions blindly. [PostgreSQL image storage documentation](https://hub.docker.com/_/postgres)

**6. Deploy and restore the data tier first**

Create/start PostgreSQL and Redis before starting restored workflows or connecting WhatsApp sessions. A separate data resource in Coolify can make this sequence easier. Attach application resources to the same explicitly configured private Docker network; record its actual name and service aliases. Being in the same Coolify project alone does not prove container connectivity.

Restore into empty destination databases. Install required extension binaries first, recreate required roles, and restore ownership and grants deliberately. Do not run all existing init scripts into the default `postgres` database: they represent different application databases.

For an empty destination cluster, an example Linux restore after securely transferring a dump is:

```bash
# Replace PG_CONTAINER with the actual Coolify PostgreSQL container name.
docker cp /secure-transfer/platform_db.dump PG_CONTAINER:/tmp/platform_db.dump
docker exec PG_CONTAINER pg_restore -U postgres --exit-on-error --create --dbname=postgres /tmp/platform_db.dump
```

This assumes the target administrative role is `postgres`, the source ownership roles already exist, and `platform_db` does not already exist. If you deliberately choose `--no-owner`/`--no-acl`, rebuild the required ownership/grants; those flags are not an equivalent permissions migration. Do not use `--clean` against an existing production database.

Repeat for all required databases. Verify expected tables, row counts, extensions, role permissions, and a representative read using each application role. PostgreSQL documents that loading newer-version dumps into older servers is not guaranteed. [PostgreSQL pg_dump compatibility](https://www.postgresql.org/docs/18/app-pgdump.html)

Keep Evolution stopped until its databases are restored. Keep n8n workflows inactive or the restored n8n service stopped until callbacks, secrets, and outbound actions are reviewed. A restored full n8n database may contain already-active workflows that run as soon as n8n starts.

**7. Configure n8n, private addresses, and secrets**

If reusing the hosted n8n, back it up and edit a disabled migration copy of the current workflow. Recreate/rebind credentials in that instance; keep its existing encryption key. Do not overwrite its database with the local n8n backup.

If moving the whole local n8n instance, restore its complete data into a fresh resource at a compatible version. Retaining SQLite initially reduces simultaneous changes. If moving n8n's own database to PostgreSQL, use the version-supported n8n export/import migration procedure; changing `DB_TYPE` alone does not migrate users, credentials, or workflows.

Configure public URL settings in Coolify Environment Variables, then restart/redeploy the applicable service:

```dotenv
N8N_HOST=n8n.glimstechai.com
N8N_PORT=5678
N8N_PROTOCOL=https
N8N_EDITOR_BASE_URL=https://n8n.glimstechai.com/
GENERIC_TIMEZONE=Asia/Karachi
TZ=Asia/Karachi
```

For the webhook base URL, use the variable supported by the pinned n8n version: older versions use `WEBHOOK_URL=https://n8n.glimstechai.com/`; current documentation describes `N8N_WEBHOOK_URL` as its replacement. Do not upgrade n8n only to adopt the new variable. Set `N8N_PROXY_HOPS` to the actual trusted proxy count: one for a direct Coolify proxy, potentially more with Cloudflare/tunnels. Verify forwarded headers and the displayed production URL. [n8n reverse proxy configuration](https://docs.n8n.io/deploy/host-n8n/configure-n8n/basic-configuration/configuration-examples/configure-webhook-urls-with-reverse-proxy)

Set secret values in Coolify, and reference them in Compose using `${VARIABLE}`. Evolution specifically expects `GLOBAL_API_KEY`, `POSTGRES_AUTH_DB`, and `POSTGRES_USERS_DB`. The n8n encryption key belongs to n8n, not Evolution. URL-encode special characters in passwords embedded in PostgreSQL URLs.

Replace local addresses in workflow parameters, Code nodes, credentials, and database-stored routing/configuration values:

| Current use | Destination on a shared private Docker network |
|---|---|
| PostgreSQL at `host.docker.internal:5432` | Actual PostgreSQL service alias, e.g. `postgres:5432` |
| Evolution at `localhost:4000` or host bridge | Actual Evolution alias, e.g. `http://evolution-go:4000` |
| Redis on the PC | Actual Redis alias, e.g. `redis:6379`, with the configured password |
| Evolution callback to local n8n | Actual n8n alias + production webhook path |

These examples only work when the named aliases actually exist on a shared network. Across separate Coolify resources, configure the shared network explicitly. Across servers, use an authenticated private network or suitable HTTPS endpoint. `host.docker.internal` on the new server does not point back to the Windows PC.

Rebind Groq and other integration credentials. Check Calendar, CRM, knowledge search, and any file paths or auxiliary APIs independently. The optional FAISS Compose profile points to a folder missing from this checkout; do not enable it unless its implementation and data are supplied. A healthy n8n container does not prove those tools work.

**8. Configure domains and the single Evolution callback**

Reuse the working routing mechanism for your domains. If direct public ingress is used, DNS and router/firewall forwarding must reach the Linux VM's Coolify proxy on HTTP/HTTPS ports. If Cloudflare Tunnel is used, route it to the correct origin instead; do not assume public port forwarding is also required. Keep PostgreSQL and Redis private.

Suggested Evolution domain: `wa.glimstechai.com` (a proposed name, not an existing verified record).

In Coolify's Compose service Domains field, current documentation uses the internal container port suffix:

```text
https://wa.glimstechai.com:4000
https://n8n.glimstechai.com:5678
```

The public browser URLs remain normal HTTPS without these suffixes; the suffix selects the proxy's internal target port. Assign the n8n domain only to the resource that should own it. [Coolify Compose configuration](https://coolify.io/docs/applications/builds/docker-compose)

Open Evolution Manager at the resulting HTTPS origin plus `/manager/instances`. Review the restored instances and set one callback per instance, for example:

```text
http://n8n:5678/webhook/evolution-whatsapp-agent
```

Use the actual reachable service alias and the exact Production URL path shown by the authoritative n8n Webhook node. If private connectivity is unavailable, use `https://n8n.glimstechai.com/webhook/<actual-path>` with appropriate webhook authentication. Do not use `/webhook-test/` for continuous service, and do not use the editor's `/workflow/<id>/` URL as a callback.

For this project's recorded Evolution behavior, keep the global `WEBHOOK_URL` empty and configure the per-instance callback. The saved source audit reports a per-instance dispatch gate and duplicate dispatch when both global and instance callbacks are configured. Recheck that behavior if changing Evolution versions.

Cloudflare Access on the administration dashboard is fine. A machine callback must not be redirected to an interactive email/login challenge. Prefer private callbacks; where public authenticated access is required, configure supported machine authentication without making the whole administration UI public.

**9. Cut over and prove the result**

Arrange a short maintenance window. Pause source workflows/ingress and writes, drain in-flight processing, take the final backups, and restore final data. Prevent both old and new gateways from using the same WhatsApp session concurrently.

Start the target services in order: PostgreSQL/Redis → n8n → Evolution. After confirming the intended instance settings, enable Evolution reconnection. If session restoration fails, reconnect with a QR code during the maintenance window. Publish/activate only the intended destination workflow and direct each instance to its one production callback.

Run the following acceptance checks:

1. PostgreSQL is ready; application-role queries work in each database.
2. Redis accepts authenticated commands and required state persists.
3. n8n readiness succeeds (`/healthz/readiness` where supported), and credentials decrypt.
4. Evolution `/server/ok` succeeds and the intended WhatsApp instance is connected.
5. Each custom Code/tool dependency executes successfully.
6. Send a new message yourself from a test number. Trace one Evolution event through one n8n execution, correct business routing, database retrieval, and the delivered reply.
7. Replay a duplicate test event and verify no duplicate reply; test a failed/retried execution as well.
8. Test knowledge search, Calendar/CRM/action tools with permitted test records if those features are part of acceptance.
9. Restart/redeploy once and verify workflows, credentials, business records, and sessions survive.
10. Shut down Windows Docker Desktop and confirm a fresh message still works. Verify the Windows PostgreSQL service is no longer being used before retiring it.

Do not equate Coolify's successful deployment status with business-level acceptance. Record the exact message/execution used for the successful test.

**10. Rollback and daily operation**

Retain the old volumes, database backups, source configuration, image references, and encryption key until acceptance. If cutover fails before new production writes, stop the target consumer, restore the original callback, and restart only the original consumer. If the new system has accepted writes or delivered messages, reconcile those records before rollback; restoring an old snapshot can lose data or replay actions.

Schedule encrypted off-machine backups of PostgreSQL, n8n state/key, Evolution state, and necessary Redis state. Test restoration into an isolated environment. Coolify configuration backup alone is not a backup of all application data. Set log retention, disk/memory alerts, and a controlled image update process.

Use pgAdmin remotely through an SSH tunnel/private connection if desired. Opening pgAdmin does not start or keep PostgreSQL running, and publishing database port 5432 to the internet is not required for administration.

**Troubleshooting quick reference**

| Symptom | First check |
|---|---|
| `no matching manifest for linux/arm64` | Correct image architecture; build the matching release if needed. |
| `exec format error` | An incompatible image or binary was selected. |
| Coolify 502/503 | Container readiness, proxy network, internal port, application bind address. |
| Database connection refused | Actual service alias/network and PostgreSQL readiness. |
| Missing database/role/vector extension | Restore/create required DBs and roles; install compatible extension binaries. |
| Cannot decrypt n8n credentials | Correct original encryption key and correct restored database. |
| `Cannot find module pg/ioredis/axios` | Package installation and allowlist in the actual code runtime/runner. |
| Webhook redirects to login | Cloudflare Access or other interactive authentication on the machine route. |
| Webhook 404 | Production path and published/active workflow registration. |
| Duplicate WhatsApp replies | Two consumers, global plus instance callbacks, or ineffective deduplication. |
| Works only while PC is on | Remaining PC address, file dependency, database, gateway, or callback. |

The next prerequisite for verifying your current remote deployment is authenticated access to the supplied Coolify and n8n pages. This guide does not claim those deployments are currently healthy or that the migration has been performed.
