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
  // Try to get cached DB stats, fetch fresh if missing
  let dbStats = null;
  try { dbStats = JSON.parse(await env.API_KV.get('stats:db') || 'null'); } catch {}
  const laws = dbStats?.laws || '1,707';
  const articles = dbStats?.articles || '499K';
  const cases = dbStats?.cases || '171K';
  const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>api.beopmang.org</title>
<style>
*{box-sizing:border-box;margin:0}
body{font-family:'SF Mono',Menlo,'Courier New',monospace;background:#fdfdfd;color:#222;max-width:680px;margin:0 auto;padding:40px 24px;font-size:14px;line-height:1.7}
h1{font-family:system-ui,sans-serif;font-size:15px;font-weight:600;margin-bottom:2px}
.sub{color:#666;font-size:12px;margin-bottom:32px}
hr{border:none;border-top:1px solid #e8e8e8;margin:28px 0}
.status{display:inline-block;width:8px;height:8px;border-radius:50%;background:#22c55e;margin-right:6px;vertical-align:middle}
.status.off{background:#ef4444}
.row{display:flex;gap:24px;margin-bottom:24px;flex-wrap:wrap}
.box{background:#f6f6f6;border:1px solid #eee;border-radius:4px;padding:10px 14px;flex:1;min-width:120px}
.box .label{font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.5px}
.box .val{font-size:18px;font-weight:600;color:#111;font-family:system-ui,sans-serif}
.copy-wrap{position:relative;margin:12px 0}
.copy-box{background:#f0f0f0;border:1px solid #ddd;border-radius:4px;padding:10px 40px 10px 14px;font-size:13px;word-break:break-all;cursor:pointer}
.copy-box:hover{background:#e8e8e8}
.copy-btn{position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:1px solid #ccc;border-radius:3px;padding:2px 8px;font-size:11px;cursor:pointer;color:#555}
.copy-btn:hover{background:#ddd}
table{width:100%;border-collapse:collapse;margin:8px 0}
td{padding:4px 0;vertical-align:top}
td:first-child{width:45%;color:#111}
td:last-child{color:#888;font-size:13px}
tr{border-bottom:1px solid #f0f0f0}
tr:last-child{border:none}
.note{font-size:11px;color:#999;line-height:1.6;margin-top:8px}
a{color:#222;text-decoration:underline;text-decoration-color:#ccc;text-underline-offset:2px}
a:hover{text-decoration-color:#222}
.tag{display:inline-block;background:#eee;border-radius:3px;padding:1px 6px;font-size:11px;color:#555;margin-left:4px}
</style></head>
<body>
<h1>api.beopmang.org</h1>
<p class="sub">대한민국 법령 DB — 실시간 쿼리 API</p>

<div class="row">
<div class="box"><div class="label">서버</div><div class="val"><span class="status"></span> online</div></div>
<div class="box"><div class="label">오늘 요청</div><div class="val">${daily}</div></div>
<div class="box"><div class="label">rate limit</div><div class="val">30/min</div></div>
</div>

<div class="row">
<div class="box"><div class="label">법률</div><div class="val">${laws}</div></div>
<div class="box"><div class="label">조문</div><div class="val">${articles}</div></div>
<div class="box"><div class="label">판례</div><div class="val">${cases}</div></div>
</div>

<hr>
<p style="font-size:12px;color:#555;margin-bottom:8px">에이전트에 이 URL을 전달하세요:</p>
<div class="copy-wrap"><div class="copy-box" onclick="copyUrl()" id="url-box">https://api.beopmang.org</div><button class="copy-btn" onclick="copyUrl()" id="copy-btn">copy</button></div>

<hr>
<p style="font-size:12px;color:#555;margin-bottom:8px">endpoints</p>
<table>
<tr><td><code>/search?q=민법</code></td><td>법령 검색</td></tr>
<tr><td><code>/law/{id}</code></td><td>법령 정보</td></tr>
<tr><td><code>/history/{id}</code></td><td>개정 연혁</td></tr>
<tr><td><code>/article/{id}/{조문}</code></td><td>조문 상세</td></tr>
<tr><td><code>/xref/{id}</code></td><td>인용관계</td></tr>
<tr><td><code>/timeline/{id}</code></td><td>입법 타임라인</td></tr>
<tr><td><code>/diff/{name}</code></td><td>최근 개정 신구대조</td></tr>
<tr><td><code>/explore/{id}</code></td><td>종합 탐색 (그래프)</td></tr>
<tr><td><code>/case?q=키워드</code></td><td>판례 검색</td></tr>
<tr><td><code>/case-by-law/{id}</code></td><td>법령별 판례</td></tr>
<tr><td><code>/hsearch?q=키워드</code></td><td>판례 하이브리드 검색</td></tr>
<tr><td><code>/bill?q=키워드</code></td><td>의안 검색</td></tr>
<tr><td><code>/usearch?q=질문</code></td><td>통합 시맨틱 검색</td></tr>
<tr><td><code>/stats</code></td><td>DB 현황</td></tr>
</table>
<p class="note"><code>?brief=1</code> 요약 (기본) · <code>?full=1</code> 전체 데이터</p>

<hr>
<p style="font-size:12px;color:#555;margin-bottom:8px">links</p>
<p style="font-size:13px"><a href="/.well-known/agent.json">agent.json</a> · <a href="/openapi.json">openapi.json</a><span class="tag">21 endpoints</span></p>

<hr>
<p class="note">데이터 출처: 법제처 Open API · 국회 Open API · Semantic Scholar<br>매주 일요일 03:00 KST 갱신. 이 API의 출력은 참고용이며 법적 효력이 없습니다.</p>

<script>
function copyUrl(){
  navigator.clipboard.writeText('https://api.beopmang.org').then(function(){
    document.getElementById('copy-btn').textContent='copied!';
    setTimeout(function(){document.getElementById('copy-btn').textContent='copy'},1500);
  });
}
</script>
</body></html>`;
  return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders(), ...rlHeaders } });
}
