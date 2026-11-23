#!/bin/sh
# Run the account/moderation command inside the running server, e.g.
#   ./deploy/account.sh make-mod sam
#   ./deploy/account.sh reports
cd "$(dirname "$0")" && docker compose exec festiville node scripts/account.mjs "$@"
