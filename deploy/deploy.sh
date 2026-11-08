#!/bin/sh
# Box side of Noggin on Jinx: /etc/apps/noggin.env (DATABASE_URL
# from jinx/bootstrap.sh), the tables, the state directory and the site block.
# The app itself runs under Coolify (deploy/compose.yaml, image from GHCR), so
# nothing is built or restarted here (FRC/DEPLOY.md). Re-runnable; on a rebuild
# jinx/restore-all.sh runs it before the app is started in Coolify.
set -eu
cd "$(dirname "$0")/.."
HOST=${HOST:-ssh.futile.studio}
NAME=noggin

scp -q deploy/$NAME.caddy server/schema.sql "$HOST":/tmp/
ssh "$HOST" "NAME=$NAME sh -s" <<'BOX'
set -eu
ENV=/etc/apps/$NAME.env
sudo -n touch "$ENV" && sudo -n chmod 600 "$ENV"
sudo -n grep -q "^DATABASE_URL=" "$ENV" || { echo "$NAME: no DATABASE_URL in $ENV, run jinx/bootstrap.sh first" >&2; exit 1; }
# schema.sql is all IF NOT EXISTS: safe on every run, and it creates the tables on the first.
PGOPTIONS='-c client_min_messages=warning' psql -q -v ON_ERROR_STOP=1 "$(sudo -n sed -n 's/^DATABASE_URL=//p' "$ENV")" -f /tmp/schema.sql
rm -f /tmp/schema.sql
# Mounted by the container, which runs as node (1000); 0700 like the old unit's.
sudo -n install -d -m 700 /var/lib/private/noggin && sudo -n chown -R 1000:1000 /var/lib/private/noggin

LIVE=/etc/caddy/conf.d/$NAME.caddy
IN=/tmp/$NAME.caddy
if cmp -s "$IN" "$LIVE"; then
  rm -f "$IN"
else
  # Imported into the config serving every site: validate, and restore on failure.
  sudo -n cp "$LIVE" "$IN.prev" 2>/dev/null || true
  sudo -n install -m 644 "$IN" "$LIVE" && rm -f "$IN"
  if ! caddy validate --adapter caddyfile --config /etc/caddy/Caddyfile >/dev/null 2>&1; then
    if [ -f "$IN.prev" ]; then sudo -n mv "$IN.prev" "$LIVE"; else sudo -n rm -f "$LIVE"; fi
    echo "$NAME: site block rejected by caddy validate, config unchanged" >&2
    exit 1
  fi
  sudo -n rm -f "$IN.prev"
  sudo -n systemctl reload caddy
fi
BOX
echo "$NAME: box side in place; deploy it from Coolify"
