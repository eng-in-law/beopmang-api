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
  const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>api.beopmang.org</title>
<style>*{box-sizing:border-box;margin:0}body{font-family:'Inter',system-ui,sans-serif;background:#fff;color:#111;max-width:600px;margin:0 auto;padding:48px 24px}h1{font-size:1.1rem;font-weight:500;letter-spacing:-.01em;margin-bottom:4px}p.sub{color:#888;font-size:.85rem;margin-bottom:48px}.section{margin-bottom:40px}.section h2{font-size:.75rem;text-transform:uppercase;letter-spacing:.08em;color:#999;margin-bottom:12px;font-weight:500}code{font-family:'SF Mono',Menlo,monospace;font-size:.82rem}.endpoint{display:block;padding:6px 0;color:#111;border-bottom:1px solid #f0f0f0}.endpoint:last-child{border:none}.endpoint code{color:#111}.endpoint span{color:#888;font-size:.8rem;margin-left:8px}a{color:#111;text-decoration:none;border-bottom:1px solid #ddd}a:hover{border-color:#111}.meta{display:flex;gap:32px;margin-bottom:48px}.meta-item{font-size:.8rem;color:#888}.meta-item strong{display:block;font-size:1rem;color:#111;font-weight:500;margin-bottom:2px}.copy{background:#f8f8f8;border-radius:6px;padding:12px 16px;font-size:.85rem;color:#333;margin:12px 0}</style></head>
<body>
<h1>api.beopmang.org</h1>
<p class="sub">대한민국 법령 DB</p>
<div class="meta"><div class="meta-item"><strong>법률 1,707</strong>현행 전체</div><div class="meta-item"><strong>조문 499K</strong>전문 검색</div><div class="meta-item"><strong>판례 171K</strong>시맨틱 검색</div></div>
<div class="section"><h2>사용법</h2><div class="copy">에이전트에 전달: https://api.beopmang.org</div></div>
<div class="section"><h2>엔드포인트</h2>
<div class="endpoint"><code>/search?q=민법</code><span>법령 검색</span></div>
<div class="endpoint"><code>/law/{id}</code><span>법령 정보</span></div>
<div class="endpoint"><code>/history/{id}</code><span>연혁</span></div>
<div class="endpoint"><code>/article/{id}/{조문}</code><span>조문 상세</span></div>
<div class="endpoint"><code>/xref/{id}</code><span>인용관계</span></div>
<div class="endpoint"><code>/case-by-law/{id}</code><span>관련 판례</span></div>
<div class="endpoint"><code>/bill?q=형법</code><span>의안</span></div>
<div class="endpoint"><code>/stats</code><span>DB 통계</span></div>
</div>
<div class="section"><h2>참고</h2><p style="font-size:.85rem;color:#888;line-height:1.8"><code>?brief=1</code> 요약 (기본) · <code>?full=1</code> 전체<br><a href="/.well-known/agent.json">Agent Card</a> · <a href="/openapi.json">OpenAPI Spec</a></p></div>
</body></html>`;
  return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders(), ...rlHeaders } });
}
