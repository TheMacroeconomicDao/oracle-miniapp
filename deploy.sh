#!/bin/bash
# Oracle Command Center — Deploy Script
# Деплоит:
#   1. miniapp/index.html → GitHub Pages (oracle-miniapp repo)
#   2. oracle-api → K8s ConfigMap + Deployment

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKSPACE="$(dirname "$SCRIPT_DIR")"

echo "🔬 Oracle Command Center — Deploy"
echo "=================================="

# ── Step 1: Deploy miniapp to GitHub Pages ────────────────────────
echo ""
echo "📱 Step 1: Deploy Mini App to GitHub Pages"
echo "-------------------------------------------"

MINIAPP_REPO="TheMacroeconomicDao/oracle-miniapp"
MINIAPP_FILE="$SCRIPT_DIR/index.html"

if [[ ! -f "$MINIAPP_FILE" ]]; then
  echo "❌ index.html not found at $MINIAPP_FILE"
  exit 1
fi

# Use GitHub API to update the file
FILE_CONTENT=$(base64 -w0 < "$MINIAPP_FILE")

# Get current file SHA (needed for update)
EXISTING=$(curl -s \
  -H "Authorization: token $BOT_GITHUB_TOKEN" \
  -H "Accept: application/vnd.github.v3+json" \
  "https://api.github.com/repos/$MINIAPP_REPO/contents/index.html" 2>/dev/null || echo "{}")

SHA=$(echo "$EXISTING" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('sha',''))" 2>/dev/null || echo "")

if [[ -n "$SHA" ]]; then
  echo "  📝 Updating existing index.html (sha: ${SHA:0:8}...)"
  PAYLOAD=$(python3 -c "
import json, sys
print(json.dumps({
  'message': 'feat: update Oracle Command Center miniapp',
  'content': sys.argv[1],
  'sha': sys.argv[2]
}))
" "$FILE_CONTENT" "$SHA")
else
  echo "  🆕 Creating new index.html"
  PAYLOAD=$(python3 -c "
import json, sys
print(json.dumps({
  'message': 'feat: Oracle Command Center miniapp initial deploy',
  'content': sys.argv[1]
}))
" "$FILE_CONTENT")
fi

RESULT=$(curl -s -X PUT \
  -H "Authorization: token $BOT_GITHUB_TOKEN" \
  -H "Accept: application/vnd.github.v3+json" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  "https://api.github.com/repos/$MINIAPP_REPO/contents/index.html")

if echo "$RESULT" | python3 -c "import json,sys; d=json.load(sys.stdin); exit(0 if d.get('content') else 1)" 2>/dev/null; then
  echo "  ✅ Deployed to https://themacroeconomicdao.github.io/oracle-miniapp/"
else
  echo "  ⚠️  GitHub API response: $(echo "$RESULT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('message','unknown'))" 2>/dev/null)"
fi

# ── Step 2: Deploy oracle-api to K8s ─────────────────────────────
echo ""
echo "🚀 Step 2: Deploy oracle-api to K8s"
echo "-------------------------------------"

API_FILE="$SCRIPT_DIR/oracle-api.js"

if [[ ! -f "$API_FILE" ]]; then
  echo "❌ oracle-api.js not found"
  exit 1
fi

# Create/update ConfigMap with the API script
echo "  📦 Creating ConfigMap oracle-api-script..."
kubectl create configmap oracle-api-script \
  --from-file=oracle-api.js="$API_FILE" \
  -n openclaw \
  --dry-run=client -o yaml | kubectl apply -f -

echo "  ✅ ConfigMap updated"

# Apply K8s manifests (service + deployment)
echo "  📦 Applying K8s manifests..."
kubectl apply -f "$SCRIPT_DIR/k8s-oracle-api.yaml" -n openclaw

echo "  ✅ K8s resources applied"

# Wait for rollout
echo "  ⏳ Waiting for rollout..."
kubectl rollout status deployment/oracle-api -n openclaw --timeout=60s || true

# Check status
echo ""
echo "  📊 oracle-api pod status:"
kubectl get pods -n openclaw -l app=oracle-api --no-headers 2>/dev/null || echo "  (kubectl not available)"

echo ""
echo "=================================="
echo "✅ Deploy complete!"
echo ""
echo "  Mini App URL:  https://t.me/SmartOracle_bot/oracle_cc"
echo "  GitHub Pages:  https://themacroeconomicdao.github.io/oracle-miniapp/"
echo "  API endpoint:  https://oracle.gyber.org/oracle-api/health"
echo ""
echo "📌 Next steps:"
echo "  1. Enable GitHub Pages in oracle-miniapp repo (Settings → Pages → main branch)"
echo "  2. Register Mini App in @BotFather: /newapp → SmartOracle_bot"
echo "     URL: https://themacroeconomicdao.github.io/oracle-miniapp/"
echo "     Short name: oracle_cc"
echo "  3. Add menu button: /setmenubutton → SmartOracle_bot"
