#!/bin/sh
# Put FestiVille online on a Linux server (Ubuntu or Debian), with automatic HTTPS, in one go.
# Run it on the server, from the festiville folder, as root (or with sudo):
#
#   ./deploy/setup-server.sh play.yourfestival.com              # your domain, pointing at this server
#   ./deploy/setup-server.sh play.yourfestival.com --loadtest   # also lift the sign-up limit for a load test
#
# It installs Docker if it's missing, saves your domain in deploy/.env, builds and starts the game
# behind Caddy (free HTTPS certificate from Let's Encrypt), waits until the game answers, and sets up
# a daily backup. Safe to run again: after copying new files it updates and restarts the game, and
# players' data (accounts, credits, camps, ...) is kept in its Docker volume.
set -eu
cd "$(dirname "$0")"

DOMAIN="${1:-}"
MODE="${2:-}"
if [ -z "$DOMAIN" ] || [ "$DOMAIN" = "-h" ] || [ "$DOMAIN" = "--help" ]; then
  echo "Usage: ./deploy/setup-server.sh <your domain> [--loadtest]"
  echo "   e.g. ./deploy/setup-server.sh play.yourfestival.com"
  exit 1
fi
case "$DOMAIN" in
  *://*|*/*|*" "*) echo "Give just the domain name, like play.yourfestival.com (no https://, no slashes)."; exit 1 ;;
esac
if [ -n "$MODE" ] && [ "$MODE" != "--loadtest" ]; then echo "Unknown option: $MODE"; exit 1; fi

say() { printf '\n==> %s\n' "$*"; }

# 1. Docker (with its Compose plugin).
if ! command -v docker >/dev/null 2>&1; then
  say "Installing Docker"
  if [ "$(id -u)" -ne 0 ]; then echo "Run this as root (or with sudo) so it can install Docker."; exit 1; fi
  curl -fsSL https://get.docker.com | sh
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "Docker is installed but its Compose plugin isn't. Update Docker (curl -fsSL https://get.docker.com | sh) and run this again."
  exit 1
fi

# 2. Settings in deploy/.env (any other settings already there are kept).
say "Saving settings in deploy/.env"
touch .env
set_env() {
  grep -v "^$1=" .env > .env.tmp || true
  if [ -n "$2" ]; then echo "$1=$2" >> .env.tmp; fi
  mv .env.tmp .env
}
set_env DOMAIN "$DOMAIN"
if [ "$MODE" = "--loadtest" ]; then set_env FV_SIGNUPS_PER_HOUR 100000; else set_env FV_SIGNUPS_PER_HOUR ""; fi
chmod 600 .env
cat .env

# 3. Where does the domain point? (A wrong DNS record is the usual reason HTTPS doesn't start.)
points_to="$(getent hosts "$DOMAIN" 2>/dev/null | awk '{print $1}' | head -n 1 || true)"
if [ -z "$points_to" ]; then
  echo "Note: $DOMAIN doesn't resolve yet. Add an A record pointing it at this server; HTTPS starts working once it does."
else
  echo "$DOMAIN points to $points_to. This server's addresses: $(hostname -I 2>/dev/null || echo unknown)"
fi

# 4. Build and start (or update and restart) the game and Caddy.
say "Building and starting the game (the first build takes a few minutes)"
docker compose up -d --build

# 5. Wait for the game server to answer.
say "Waiting for the game to start"
ok=""
i=0
while [ $i -lt 60 ]; do
  if docker compose exec -T festiville wget -qO- http://127.0.0.1:2567/api/health >/dev/null 2>&1; then ok=1; break; fi
  i=$((i + 1)); sleep 2
done
if [ -z "$ok" ]; then
  echo "The game didn't answer after 2 minutes. Its log:"
  docker compose logs --tail 40 festiville
  exit 1
fi
echo "The game is running."

# 6. A daily backup at 04:17 (server time), keeping the newest 14, in the folder above deploy/.
if command -v crontab >/dev/null 2>&1; then
  here="$(pwd)"
  line="17 4 * * * cd $here && ./backup.sh >/dev/null 2>&1 && ls -1t ../festiville-data-*.tar.gz | tail -n +15 | xargs -r rm -- # festiville-backup"
  ( crontab -l 2>/dev/null | grep -v "# festiville-backup" || true; echo "$line" ) | crontab -
  echo "Daily backup set up (crontab -l to see it). Copy the backups somewhere other than this server now and then."
else
  echo "No cron here, so no automatic backups. Run ./deploy/backup.sh yourself (daily is good)."
fi

say "Done! Open https://$DOMAIN"
echo "  The first visit can take a minute while the HTTPS certificate is issued."
echo "  Make yourself the festival organizer (staff tools + festival builder) after signing up in the game:"
echo "    ./deploy/account.sh make-admin <your username>"
if [ "$MODE" = "--loadtest" ]; then
  echo "  The sign-up limit is lifted for a load test. Afterwards, run this again without --loadtest."
fi
