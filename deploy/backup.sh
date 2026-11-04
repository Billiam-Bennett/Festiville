#!/bin/sh
# Copy the game's saved data (accounts, vendors, reports) to a dated .tar.gz in the current folder.
# Run it daily (e.g. from cron) and keep copies somewhere other than this server.
set -e
cd "$(dirname "$0")"
out="festiville-data-$(date +%Y%m%d-%H%M).tar.gz"
docker compose exec -T festiville tar czf - -C /app data > "../$out"
echo "Saved $out"
