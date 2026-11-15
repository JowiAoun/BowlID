#!/usr/bin/env bash
# Build the site and publish it to Cloudflare Pages.
# Run `npx wrangler login` once before the first deploy.
set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT="${BOWLBANK_PAGES_PROJECT:-bowlbank}"

if ! npx wrangler whoami 2>&1 | grep -q 'You are logged in'; then
  echo "Not logged in to Cloudflare. Run: npx wrangler login" >&2
  exit 1
fi

npm run build

# Creating the project fails when it already exists. That is fine.
npx wrangler pages project create "$PROJECT" --production-branch main >/dev/null 2>&1 || true
npx wrangler pages deploy dist --project-name "$PROJECT" --branch main --commit-dirty=true
