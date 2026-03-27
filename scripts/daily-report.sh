#!/bin/bash
# daily-report.sh — 법망 API 일일 보고서
# 크론: 0 9 * * * bash ~/beopmang-api/scripts/daily-report.sh
set -euo pipefail

ACCOUNT_ID="620f18d4a719cadf71aece4130208c41"
DATASET="ANALYTICS"
# .env에서 토큰 로드
if [ -f "$HOME/beopmang-api/.env" ]; then
  export $(grep -v '^#' "$HOME/beopmang-api/.env" | xargs)
fi
API_TOKEN="${CLOUDFLARE_API_TOKEN:-${CF_API_TOKEN:-}}"
REPORT_DIR="$HOME/beopmang-api/reports"
DATE=$(date -d "yesterday" +%Y-%m-%d 2>/dev/null || date -v-1d +%Y-%m-%d)
REPORT="$REPORT_DIR/$DATE.md"

mkdir -p "$REPORT_DIR"

if [ -z "$API_TOKEN" ]; then
  echo "CF_API_TOKEN 환경변수 필요. export CF_API_TOKEN=your_token"
  exit 1
fi

wae_query() {
  local sql="$1"
  curl -s "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/analytics_engine/sql" \
    -H "Authorization: Bearer $API_TOKEN" \
    -d "$sql" 2>/dev/null
}

# --- Health check ---
HEALTH=$(curl -s --max-time 10 https://api.beopmang.org/health)
HEALTH_STATUS=$(echo "$HEALTH" | python3 -c "import sys,json;print(json.load(sys.stdin).get('status','unknown'))" 2>/dev/null || echo "down")
HEALTH_MS=$(echo "$HEALTH" | python3 -c "import sys,json;print(json.load(sys.stdin).get('origin_ms','?'))" 2>/dev/null || echo "?")

# --- WAE queries ---
TOTAL=$(wae_query "SELECT count() as cnt FROM ANALYTICS WHERE timestamp >= toDateTime('${DATE}T00:00:00Z') AND timestamp < toDateTime('${DATE}T00:00:00Z') + INTERVAL '1' DAY")
TOTAL_CNT=$(echo "$TOTAL" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('data',[{}])[0].get('cnt',0))" 2>/dev/null || echo "0")

TOP_PAIRS=$(wae_query "SELECT blob1 as prev_action, blob2 as curr_action, count() as cnt FROM ANALYTICS WHERE timestamp >= toDateTime('${DATE}T00:00:00Z') AND timestamp < toDateTime('${DATE}T00:00:00Z') + INTERVAL '1' DAY GROUP BY blob1, blob2 ORDER BY cnt DESC LIMIT 10")

TOP_LAWS=$(wae_query "SELECT index1 as law_id, count() as cnt FROM ANALYTICS WHERE timestamp >= toDateTime('${DATE}T00:00:00Z') AND timestamp < toDateTime('${DATE}T00:00:00Z') + INTERVAL '1' DAY AND index1 != '_' GROUP BY index1 ORDER BY cnt DESC LIMIT 10")

AVG_GAP=$(wae_query "SELECT avg(double1) as avg_ms FROM ANALYTICS WHERE timestamp >= toDateTime('${DATE}T00:00:00Z') AND timestamp < toDateTime('${DATE}T00:00:00Z') + INTERVAL '1' DAY")

# --- Generate report ---
cat > "$REPORT" << REPORT_EOF
# 법망 API 일일 보고서 — $DATE

## 서버 상태
- 현재: $HEALTH_STATUS ($HEALTH_MS ms)

## 사용량
- co-occurrence 이벤트: $TOTAL_CNT 건

## 호출 패턴 (Top 10)
\`\`\`
$(echo "$TOP_PAIRS" | python3 -c "
import sys,json
try:
    d=json.load(sys.stdin)
    for r in d.get('data',[]):
        print(f\"{r.get('prev_action','?')} → {r.get('curr_action','?')}: {r.get('cnt',0)}건\")
except: print('데이터 없음')
" 2>/dev/null || echo "데이터 없음")
\`\`\`

## 자주 조회된 법령 (Top 10)
\`\`\`
$(echo "$TOP_LAWS" | python3 -c "
import sys,json
try:
    d=json.load(sys.stdin)
    for r in d.get('data',[]):
        print(f\"law_id={r.get('law_id','?')}: {r.get('cnt',0)}건\")
except: print('데이터 없음')
" 2>/dev/null || echo "데이터 없음")
\`\`\`

## 평균 호출 간격
$(echo "$AVG_GAP" | python3 -c "
import sys,json
try:
    d=json.load(sys.stdin)
    ms=d.get('data',[{}])[0].get('avg_ms',0)
    print(f'{ms:.0f}ms ({ms/1000:.1f}초)')
except: print('데이터 없음')
" 2>/dev/null || echo "데이터 없음")

## 특이점
$([ "$HEALTH_STATUS" != "ok" ] && echo "- 서버 상태 비정상: $HEALTH_STATUS" || echo "- 없음")

---
*자동 생성: $(date +%Y-%m-%d\ %H:%M:%S)*
REPORT_EOF

echo "보고서 생성: $REPORT"
cat "$REPORT"
