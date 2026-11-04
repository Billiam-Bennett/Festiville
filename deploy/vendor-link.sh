#!/bin/sh
# Make a vendor's private edit link on the hosted server, e.g.
#   ./deploy/vendor-link.sh hippiedips --base https://play.yourfestival.com
cd "$(dirname "$0")" && docker compose exec festiville node scripts/vendor-link.mjs "$@"
