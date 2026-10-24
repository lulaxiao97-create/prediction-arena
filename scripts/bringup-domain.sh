#!/usr/bin/env bash
# One-shot custom-domain bring-up: DNS → Render domain → deploy → verification.
#
# Everything that needs a credential is read from the environment; nothing is written to disk
# here, and every step is idempotent, so re-running after a partial failure is safe.
#
#   export CF_API_TOKEN=...        # Zone:DNS:Edit, Zone:Read (+ Account:Read to create the zone)
#   export CF_ACCOUNT_ID=...       # only needed if the zone does not exist yet
#   export RENDER_API_KEY=...      # dashboard.render.com → Account Settings → API Keys
#   export RENDER_DEPLOY_HOOK=...  # optional: force a deploy even without a push
#   bash scripts/bringup-domain.sh [--proxied]
#
# Requires: the zone to be delegated to Cloudflare NS at the registrar (done at the registrar).
set -euo pipefail

cd "$(dirname "$0")/.."
PROXIED="${1:-}"
PROXY="${VERIFY_PROXY:-}"

step() { printf '\n=== %s\n' "$1"; }

step "1/4 Cloudflare DNS"
if [ -z "${CF_API_TOKEN:-}" ]; then
  echo "SKIP: CF_API_TOKEN is not set (zone + records cannot be created without it)"
else
  python3 tools/cloudflare_dns.py $PROXIED
fi

step "2/4 Render custom domains"
if [ -z "${RENDER_API_KEY:-}" ]; then
  echo "SKIP: RENDER_API_KEY is not set (custom domains must be added in the dashboard)"
else
  python3 tools/render_domains.py
fi

step "3/4 Deploy"
if [ -n "${RENDER_DEPLOY_HOOK:-}" ]; then
  curl -fsS -X POST "$RENDER_DEPLOY_HOOK" && echo "deploy triggered"
else
  echo "SKIP: RENDER_DEPLOY_HOOK is not set — the push to main triggers CI, CI triggers the deploy"
fi

step "4/4 Verify"
echo "Render issues the certificate after the DNS records resolve; up to ~5 minutes."
for i in $(seq 1 30); do
  if python3 tools/verify_domain.py ${PROXY:+--proxy "$PROXY"} >/tmp/verify_domain.out 2>&1; then
    cat /tmp/verify_domain.out
    exit 0
  fi
  sleep 20
done
cat /tmp/verify_domain.out
echo "verification still failing after ~10 minutes — see the output above"
exit 1
