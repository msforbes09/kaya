# Deploying Kaya to a VPS

Docker Compose runs the app (Node, built from the repo) behind Caddy, which
terminates TLS. Postgres runs on the host, not in a container, so backups and
`pgvector` upgrades are ordinary host operations.

## 1. Postgres on the host

```bash
sudo -u postgres psql -c "CREATE ROLE kaya LOGIN PASSWORD '...';" -c "CREATE DATABASE kaya OWNER kaya;"
psql -U kaya -d kaya -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

Allow the Docker bridge network to reach Postgres:

- In `postgresql.conf`, set `listen_addresses = 'localhost,172.17.0.1'`.
- In `pg_hba.conf`, add `host kaya kaya 172.16.0.0/12 scram-sha-256`.
- `sudo systemctl reload postgresql`

If `CREATE EXTENSION vector` fails, install `postgresql-17-pgvector` from the
PGDG apt repo, then retry.

## 2. GitHub OAuth app

Create an OAuth app with callback `https://<DOMAIN>/auth/github/callback`.

## 3. `.env` on the VPS

Copy the keys from `.env.example` and fill them in, with:

```
PUBLIC_URL=https://<DOMAIN>
DATABASE_URL=postgres://kaya:<pw>@host.docker.internal:5432/kaya
DOMAIN=<DOMAIN>
```

### Ports

`PORT` (app), `HTTP_PORT` and `HTTPS_PORT` (Caddy on the host) all come from
`.env`. If the VPS already runs nginx, Traefik or another proxy on 80/443,
leave Caddy out and publish the app on loopback for that proxy to reach:

```bash
docker compose -f docker-compose.yml -f docker-compose.expose.yml up -d --build app
```

Then proxy `https://<DOMAIN>` to `http://127.0.0.1:<PORT>` with WebSocket
upgrade enabled for `/ws` and `/runner`.

## 4. First deploy

```bash
git clone git@github.com:msforbes09/kaya.git && cd kaya && docker compose up -d --build
docker compose exec app npm run invite:prod -- --admin
```

`--admin` grants nothing by itself: nothing in v1 reads `is_admin`. It prints
the invite code and the SQL to promote yourself once you have signed in:

```bash
psql -U kaya -d kaya -c "UPDATE members SET is_admin = true WHERE github_login = '<you>';"
```

## 5. Updates

```bash
git pull && docker compose up -d --build
```

## 6. Backups

Add to the host crontab:

```
0 3 * * * pg_dump -U kaya kaya | gzip > /var/backups/kaya/$(date +\%F).sql.gz
```

## 7. Health

Point an uptime pinger at `https://<DOMAIN>/api/health`. Tail app logs with:

```bash
docker compose logs -f app
```

## 8. Runner on each machine

```bash
KAYA_CLOUD_URL=https://<DOMAIN> npx kaya-runner
```

Team members need Node 20+ and a `claude` login on that machine. The package
page on npm carries the full instructions.
