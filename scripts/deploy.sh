#!/usr/bin/env bash
# Build the site and publish it to Cloudflare Pages.
# Run `npx wrangler login` once before the first deploy.
set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT="${BOWLBANK_PAGES_PROJECT:-bowlometrics}"

if ! npx wrangler whoami 2>&1 | grep -q 'You are logged in'; then
  echo "Not logged in to Cloudflare. Run: npx wrangler login" >&2
  exit 1
fi

npm run build

# Create the Pages project the first time. --force keeps it on classic Cloudflare Pages,
# so the address is <project>.pages.dev.
if ! npx wrangler pages project list 2>/dev/null | grep -q "│ $PROJECT "; then
  npx wrangler pages project create "$PROJECT" --production-branch main --force
fi
npx wrangler pages deploy dist --project-name "$PROJECT" --branch main --commit-dirty=true
