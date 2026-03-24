const WHITELIST = new Set([
  'search','law','history','article','byulpyo','timeline','usearch','hsearch',
  'stats','xref','case','case-view','case-text','case-vsearch','case-by-law',
  'bill','bill-detail','bill-minutes','bill-sponsors','bill-vote',
  'treaty','treaty-view','paper','neighbors','explore',
  'diff','ordinance','jo-code','ref','follow'
]);

const BRIEF_FIELDS = {
  search: ['law_id','law_name','unit_level','label'],
  law: ['law_id','law_name','law_type','article_count','effective_date','ministry'],
  history: ['revision_type','old_effective_date','new_effective_date','changed_article_count'],
  xref: ['law_id','law_name','source_article','target_article'],
  case: ['case_id','case_name','court','decided_date'],
  'case-by-law': ['case_id','case_name','court','decided_date'],
  bill: ['BILL_ID','BILL_NO','BILL_NAME','PROPOSER','PROPOSE_DT','PROC_RESULT'],
  timeline: ['date','type','content'],
};

const RATE_LIMIT = 30;
const RATE_WINDOW = 60;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const rl = await checkRateLimit(env.API_KV, ip);
    if (!rl.ok) {
      return json({ ok: false, error: 'rate_limit_exceeded', retry_after: rl.reset }, 429, rl.headers);
    }

    if (path === '/' || path === '') {
      if ((request.headers.get('Accept') || '').includes('text/html')) {
        return statusPage(env, rl.headers);
      }
      return json({
        name: '법령 검색 API',
        description: '대한민국 법령 DB 실시간 쿼리',
        discovery: '/.well-known/agent.json',
        docs: '/openapi.json',
        example: '/search?q=민법&brief=1',
        source: 'live_database'
      }, 200, rl.headers);
    }

    if (path === '/.well-known/agent.json') {
      const data = await env.API_KV.get('agent.json');
      return new Response(data || '{}', {
        headers: { ...corsHeaders(), 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' }
      });
    }

    if (path === '/openapi.json') {
      const data = await env.API_KV.get('openapi.json');
      return new Response(data || '{}', {
        headers: { ...corsHeaders(), 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' }
      });
    }

    const parsed = parseCommand(path, url.searchParams);
    if (!parsed) {
      return json({ ok: false, error: 'not_found', hint: 'GET / for API info' }, 404, rl.headers);
    }
    if (!WHITELIST.has(parsed.cmd)) {
      return json({ ok: false, error: 'command_not_allowed', command: parsed.cmd }, 403, rl.headers);
    }

    const full = url.searchParams.get('full') === '1';
    const mode = full ? 'full' : 'brief';

    const originUrl = new URL(env.ORIGIN_BASE + '/api/lawcli');
    originUrl.searchParams.set('cmd', parsed.cmd);
    if (parsed.args) originUrl.searchParams.set('args', parsed.args);
    if (parsed.flags) originUrl.searchParams.set('flags', parsed.flags);
    originUrl.searchParams.set('json', '1');

    const t0 = Date.now();
    let originResp;
    try {
      originResp = await fetch(originUrl.toString(), { headers: { 'User-Agent': 'beopmang-api/1.0' } });
    } catch (e) {
      return json({ ok: false, error: 'service_unavailable', retry_after: 30 }, 503, rl.headers);
    }
    if (!originResp.ok) {
      return json({ ok: false, error: 'origin_error', status: originResp.status }, 502, rl.headers);
    }

    const elapsed = Date.now() - t0;
    let originData;
    try {
      originData = await originResp.json();
    } catch (e) {
      return json({ ok: false, error: 'invalid_origin_response' }, 502, rl.headers);
    }

    if (originData.exit_code !== 0) {
      return json({ ok: false, error: 'command_failed', detail: originData.output || '', command: parsed.cmd }, 422, rl.headers);
    }

    let result;
    try {
      result = JSON.parse(originData.output);
    } catch (e) {
      result = originData.output;
    }

    if (mode === 'brief' && BRIEF_FIELDS[parsed.cmd]) {
      result = applyBrief(result, BRIEF_FIELDS[parsed.cmd]);
    }

    const count = Array.isArray(result) ? result.length : undefined;

    env.API_KV.put('stats:daily', String((parseInt(await env.API_KV.get('stats:daily') || '0') + 1)), { expirationTtl: 86400 }).catch(() => {});

    return json({
      ok: true,
      command: parsed.cmd,
      mode,
      result,
      ...(count !== undefined && { count }),
      meta: { source: 'live_database', db_query_ms: originData.meta?.elapsed_ms || elapsed, elapsed_ms: Date.now() - t0, ...(originData.meta || {}) }
    }, 200, rl.headers);
  }
};

function applyBrief(data, fields) {
  if (!fields) return data;
  const pick = (obj) => {
    if (typeof obj !== 'object' || obj === null) return obj;
    const out = {};
    for (const f of fields) { if (f in obj) out[f] = obj[f]; }
    return out;
  };
  return Array.isArray(data) ? data.map(pick) : pick(data);
}

function parseCommand(path, params) {
  const parts = path.split('/').filter(Boolean);
  if (!parts.length) return null;
  const cmd = parts[0];
  let args = parts.slice(1).map(decodeURIComponent).join(' ');
  const q = params.get('q');
  if (q && !args) args = q;
  let flags = '';
  if (params.get('cited-by') === '1') flags = '--cited-by';
  for (const f of ['limit','top-k','date','type','age']) {
    const v = params.get(f);
    if (v) flags += (flags ? ' ' : '') + '--' + f + ' ' + v;
  }
  return { cmd, args: args || undefined, flags: flags || undefined };
}

async function checkRateLimit(kv, ip) {
  const key = `rl:${ip}`;
  const now = Math.floor(Date.now() / 1000);
  let data;
  try { data = JSON.parse(await kv.get(key) || '[]'); } catch { data = []; }
  data = data.filter(t => t > now - RATE_WINDOW);
  const remaining = Math.max(0, RATE_LIMIT - data.length);
  const reset = data.length ? data[0] + RATE_WINDOW : now + RATE_WINDOW;
  const headers = {
    'X-RateLimit-Limit': String(RATE_LIMIT),
    'X-RateLimit-Remaining': String(remaining),
    'X-RateLimit-Reset': String(reset),
  };
  if (data.length >= RATE_LIMIT) return { ok: false, reset, headers };
  data.push(now);
  kv.put(key, JSON.stringify(data), { expirationTtl: RATE_WINDOW * 2 }).catch(() => {});
  headers['X-RateLimit-Remaining'] = String(remaining - 1);
  return { ok: true, headers };
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff', ...corsHeaders(), ...extra }
  });
}

async function statusPage(env, rlHeaders) {
  const daily = await env.API_KV.get('stats:daily') || '0';
  const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>api.beopmang.org</title>
<style>*{box-sizing:border-box;margin:0}body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;padding:32px;min-height:100vh}h1{font-size:1.4rem;color:#fff;margin-bottom:8px}.sub{color:#64748b;font-size:.9rem;margin-bottom:32px}.card{background:#1e293b;border-radius:12px;padding:20px;margin-bottom:16px}.card h2{font-size:1rem;color:#94a3b8;margin-bottom:12px}.stat{font-size:2rem;color:#fff;font-weight:600}.stat small{font-size:.9rem;color:#64748b;font-weight:400}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px}code{background:#334155;padding:2px 6px;border-radius:4px;font-size:.85rem}a{color:#60a5fa;text-decoration:none}a:hover{text-decoration:underline}.cmd{color:#94a3b8;font-size:.85rem;line-height:2}</style></head>
<body>
<h1>api.beopmang.org</h1>
<p class="sub">대한민국 법령 DB 실시간 쿼리 API</p>
<div class="grid">
<div class="card"><h2>상태</h2><div class="stat">● <small>온라인</small></div></div>
<div class="card"><h2>오늘 요청</h2><div class="stat">${daily} <small>건</small></div></div>
<div class="card"><h2>레이트 리밋</h2><div class="stat">30 <small>/min per IP</small></div></div>
</div>
<div class="card"><h2>시작하기</h2><p style="margin-bottom:12px">에이전트에 이 한 줄을 전달하세요:</p><code>법령 검색 API: https://api.beopmang.org</code><p style="margin-top:16px"><a href="/.well-known/agent.json">Agent Card</a> · <a href="/openapi.json">OpenAPI Spec</a> · <a href="/stats">DB 통계</a></p></div>
<div class="card"><h2>사용 예시</h2><div class="cmd"><code>GET /search?q=민법</code> 법령 검색<br><code>GET /law/001692</code> 법령 조회<br><code>GET /history/001692</code> 연혁 조회<br><code>GET /article/001692/제1조</code> 조문 조회<br><code>GET /xref/001692</code> 인용관계<br><code>GET /case-by-law/001692</code> 관련 판례<br><code>GET /bill?q=형법</code> 의안 검색<br><code>GET /stats</code> DB 통계<br><br><code>?brief=1</code> 핵심만 (기본) · <code>?full=1</code> 전체 데이터</div></div>
</body></html>`;
  return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders(), ...rlHeaders } });
}
