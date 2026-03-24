const WHITELIST = new Set([
  'search','law','history','article','byulpyo','timeline','usearch','hsearch',
  'stats','xref','case','case-view','case-text','case-vsearch','case-by-law',
  'bill','bill-detail','bill-minutes','bill-sponsors','bill-vote',
  'treaty','treaty-view','neighbors','explore',
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

const RATE_LIMIT = 100;
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

    if (path === '/robots.txt') {
      return new Response('User-agent: *\nAllow: /\n\nSitemap: https://api.beopmang.org/sitemap.xml\n', {
        headers: { 'Content-Type': 'text/plain' }
      });
    }

    if (path === '/sitemap.xml') {
      const urls = ['/', '/stats', '/openapi.json', '/.well-known/agent.json',
        '/find?q=민법', '/law/001692', '/history/001692', '/article/001692/제1조',
        '/xref/001692', '/case-by-law/001692', '/bill?q=형법', '/timeline/001692',
        '/explore/001692', '/usearch?q=법률행위', '/health'];
      const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
        urls.map(u => '  <url><loc>https://api.beopmang.org' + u + '</loc><changefreq>daily</changefreq></url>').join('\n') +
        '\n</urlset>';
      return new Response(xml, { headers: { 'Content-Type': 'application/xml' } });
    }

    if (path === '/' || path === '') {
      if ((request.headers.get('Accept') || '').includes('text/html')) {
        return statusPage(env, rl.headers);
      }
      const ts = new Date().toISOString();
      const daily = await env.API_KV.get('stats:daily') || '0';
      return json({
        name: '법령 검색 API',
        description: '대한민국 법령 DB 실시간 쿼리. 법률 1,707개, 조문 499K, 판례 171K.',
        source: 'live_database',
        timestamp: ts,
        today_requests: parseInt(daily),
        rate_limit: '100/min per IP',
        endpoints: {
          '/find?q={name}': '법령명으로 찾기 (완전일치 우선). 먼저 이걸로 law_id를 확인',
          '/law/{id}': '법령 기본정보',
          '/history/{id}': '개정 연혁',
          '/article/{id}/{조문}': '조문 상세',
          '/search?q={keyword}': '조문 본문 키워드 검색',
          '/usearch?q={query}': '자연어 시맨틱 검색 (법령+판례+제안이유)',
          '/xref/{id}': '법령 간 인용관계',
          '/case-by-law/{id}': '법령별 판례',
          '/bill?q={keyword}': '국회 의안 검색',
          '/timeline/{id}': '입법 타임라인',
          '/explore/{id}': '법령 종합 탐색 (그래프)',
          '/stats': 'DB 현황',
          '/health': '서버 상태',
        },
        usage: '?brief=1 (기본, 핵심만) / ?full=1 (전체). 한글은 URL-encode 필수.',
        docs: '/openapi.json',
        agent_card: '/.well-known/agent.json',
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

    if (path === '/health') {
      try {
        const t = Date.now();
        const r = await fetch(env.ORIGIN_BASE + '/api/lawcli?cmd=stats&json=1', {
          headers: { 'User-Agent': 'beopmang-api/health' },
          signal: AbortSignal.timeout(5000),
        });
        const ms = Date.now() - t;
        if (r.ok) {
          env.API_KV.put('health:status', 'ok', { expirationTtl: 120 }).catch(() => {});
          env.API_KV.put('health:latency', String(ms), { expirationTtl: 120 }).catch(() => {});
          return json({ status: 'ok', origin_ms: ms }, 200, rl.headers);
        }
        return json({ status: 'degraded', origin_status: r.status }, 200, rl.headers);
      } catch (e) {
        return json({ status: 'down', error: e.message }, 200, rl.headers);
      }
    }

    const parsed = parseCommand(path, url.searchParams);
    if (!parsed) {
      return json({ ok: false, error: 'not_found', hint: 'GET / for API info' }, 404, rl.headers);
    }
    if (!WHITELIST.has(parsed.cmd)) {
      return json({ ok: false, error: 'command_not_allowed', command: parsed.cmd }, 403, rl.headers);
    }

    const briefParam = url.searchParams.get('brief');
    const fullParam = url.searchParams.get('full');
    const mode = fullParam === '1' || briefParam === '0' ? 'full' : 'brief';

    let originQs = 'cmd=' + encodeURIComponent(parsed.cmd);
    if (parsed.args) originQs += '&args=' + encodeURIComponent(parsed.args);
    if (parsed.flags) originQs += '&flags=' + encodeURIComponent(parsed.flags);
    originQs += '&json=1';
    const originUrl = env.ORIGIN_BASE + '/api/lawcli?' + originQs;

    const cacheKey = `cache:${parsed.cmd}:${parsed.args||''}:${parsed.flags||''}`;
    const t0 = Date.now();
    let originData;
    let fromCache = false;

    try {
      const originResp = await fetch(originUrl, {
        headers: { 'User-Agent': 'beopmang-api/1.0' },
        cf: { cacheTtl: 0 },
      });
      if (!originResp.ok) throw new Error('origin ' + originResp.status);
      originData = await originResp.json();
      // Cache successful responses (5 min TTL)
      env.API_KV.put(cacheKey, JSON.stringify(originData), { expirationTtl: 300 }).catch(() => {});
    } catch (e) {
      // Fallback: try KV cache
      try {
        const cached = await env.API_KV.get(cacheKey);
        if (cached) {
          originData = JSON.parse(cached);
          fromCache = true;
        } else {
          return json({ ok: false, error: 'service_unavailable', retry_after: 30 }, 503, rl.headers);
        }
      } catch {
        return json({ ok: false, error: 'service_unavailable', retry_after: 30 }, 503, rl.headers);
      }
    }

    const elapsed = Date.now() - t0;

    if (originData.exit_code !== 0) {
      const rawDetail = originData.output || '';
      const cleanDetail = rawDetail.replace(/lawcli\.py/g, 'lawcli').replace(/\/home\/[^\s]+/g, '').replace(/Traceback[\s\S]*$/m, '').trim();
      return json({ ok: false, error: 'command_failed', detail: cleanDetail || 'command returned an error', command: parsed.cmd }, 422, rl.headers);
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

    const payload = {
      ok: true,
      command: parsed.cmd,
      mode,
      result,
      ...(count !== undefined && { count }),
      meta: { source: fromCache ? 'cache' : 'live_database', db_query_ms: originData.meta?.elapsed_ms || elapsed, elapsed_ms: Date.now() - t0, ...(originData.meta || {}), ...(fromCache && { cached: true }) }
    };

    if (parsed.forceHtml || (request.headers.get('Accept') || '').includes('text/html')) {
      return resultPage(parsed.cmd, parsed.args, payload, rl.headers);
    }
    return json(payload, 200, rl.headers);
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
  // Strip .html suffix — agents treat .html URLs as webpages and will browse them
  let forceHtml = false;
  let cleanPath = path;
  if (cleanPath.endsWith('.html')) {
    cleanPath = cleanPath.slice(0, -5);
    forceHtml = true;
  }
  const decoded = decodeURIComponent(cleanPath.replace(/\+/g, ' '));
  const parts = decoded.split('/').filter(Boolean);
  if (!parts.length) return null;
  let cmd = parts[0];
  let args = parts.slice(1).join(' ');
  // ?q= takes priority — agents should prefer this for Korean/spaces
  const q = params.get('q');
  if (q) args = q;
  // /find → lawcli law (법령명 매칭)
  // /search → lawcli search (조문 본문 검색)
  if (cmd === 'find') cmd = 'law';
  let flags = '';
  if (params.get('cited-by') === '1') flags = '--cited-by';
  for (const f of ['limit','top-k','date','type','age']) {
    const v = params.get(f);
    if (v) flags += (flags ? ' ' : '') + '--' + f + ' ' + v;
  }
  return { cmd, args: args || undefined, flags: flags || undefined, forceHtml };
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

function resultPage(cmd, args, payload, rlHeaders) {
  // Title = CLI command style
  let title = 'lawcli ' + cmd + (args ? ' ' + args : '');
  // Append brief result summary to title
  const r = payload.result;
  if (Array.isArray(r) && r.length > 0) {
    const names = r.slice(0, 3).map(i => (i && typeof i === 'object') ? (i.law_name || i.case_name || i.BILL_NAME || i.label || '') : '').filter(Boolean);
    title += ' — ' + names.join(', ') + (r.length > 3 ? ' 외 ' + (r.length - 3) + '건' : '');
  } else if (typeof r === 'object' && r !== null && !Array.isArray(r)) {
    const name = r.law_name || r.case_name || r.BILL_NAME || '';
    if (name) title += ' — ' + name;
  }
  const resultJson = JSON.stringify(payload.result, null, 2);
  const meta = payload.meta || {};
  let resultHtml = '';
  const B = 'https://api.beopmang.org';
  function lawLinks(id, name) {
    if (!id) return '';
    const e = encodeURIComponent;
    return ' <a href="' + B + '/law/' + e(id) + '.html">법령정보</a>' +
      ' · <a href="' + B + '/history/' + e(id) + '.html">연혁</a>' +
      ' · <a href="' + B + '/xref/' + e(id) + '.html">인용관계</a>' +
      ' · <a href="' + B + '/case-by-law/' + e(id) + '.html">판례</a>' +
      ' · <a href="' + B + '/timeline/' + e(id) + '.html">타임라인</a>';
  }
  if (Array.isArray(r)) {
    resultHtml = '<ul>' + r.slice(0, 20).map(item => {
      if (typeof item === 'object' && item !== null) {
        const name = item.law_name || item.case_name || item.BILL_NAME || item.label || '';
        const id = item.law_id || item.case_id || item.BILL_ID || '';
        const detail = item.content || item.unit_level || item.revision_type || '';
        let links = '';
        if (item.law_id) links = lawLinks(item.law_id, name);
        else if (item.case_id) links = ' <a href="' + B + '/case-view/' + encodeURIComponent(item.case_id) + '.html">상세</a>';
        else if (item.BILL_ID) links = ' <a href="' + B + '/bill-detail/' + encodeURIComponent(item.BILL_ID) + '.html">상세</a>';
        return '<li><strong>' + escapeHtmlW(name) + '</strong>' + (id ? ' <code>' + id + '</code>' : '') + (detail ? ' — ' + escapeHtmlW(String(detail).slice(0, 120)) : '') + (links ? '<br>' + links : '') + '</li>';
      }
      return '<li>' + escapeHtmlW(String(item).slice(0, 200)) + '</li>';
    }).join('') + '</ul>' + (r.length > 20 ? '<p>... 외 ' + (r.length - 20) + '건</p>' : '');
  } else if (typeof r === 'object' && r !== null) {
    const id = r.law_id || '';
    let nav = '';
    if (id) nav = '<p style="margin:12px 0">' + lawLinks(id, r.law_name || '') + '</p>';
    // Show articles as links if present
    let articlesHtml = '';
    if (r.articles && Array.isArray(r.articles)) {
      articlesHtml = '<p style="margin-top:12px"><strong>조문:</strong> ' + r.articles.slice(0, 30).map(a => '<a href="' + B + '/article/' + encodeURIComponent(id) + '/' + encodeURIComponent(a) + '.html">' + escapeHtmlW(a) + '</a>').join(' · ') + (r.articles.length > 30 ? ' ... 외 ' + (r.articles.length - 30) + '개' : '') + '</p>';
    }
    resultHtml = nav + '<dl>' + Object.entries(r).filter(([k]) => k !== 'articles').slice(0, 30).map(([k, v]) => {
      const val = typeof v === 'object' ? JSON.stringify(v) : String(v);
      return '<dt>' + escapeHtmlW(k) + '</dt><dd>' + escapeHtmlW(val.slice(0, 300)) + '</dd>';
    }).join('') + '</dl>' + articlesHtml;
  } else {
    resultHtml = '<pre>' + escapeHtmlW(String(r).slice(0, 2000)) + '</pre>';
  }
  const html = '<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + escapeHtmlW(title) + ' — api.beopmang.org</title>' +
    '<style>*{box-sizing:border-box;margin:0}body{font-family:system-ui,sans-serif;background:#fdfdfd;color:#222;max-width:720px;margin:0 auto;padding:32px 24px;font-size:14px;line-height:1.7}' +
    'h1{font-size:16px;margin-bottom:4px}code{background:#f0f0f0;padding:1px 4px;border-radius:3px;font-size:13px}' +
    'pre{background:#f6f6f6;border:1px solid #eee;padding:12px;border-radius:6px;overflow-x:auto;font-size:12px;line-height:1.5}' +
    'dl{margin:8px 0}dt{font-weight:600;color:#555;font-size:12px;margin-top:8px}dd{margin-left:0;margin-bottom:4px}' +
    'ul{padding-left:20px}li{margin:4px 0}.meta{color:#888;font-size:12px;margin:12px 0}' +
    'a{color:#222;text-decoration:underline;text-decoration-color:#ccc}a:hover{text-decoration-color:#222}</style></head>' +
    '<body><h1>' + escapeHtmlW(title) + '</h1>' +
    '<p class="meta">source: ' + (meta.source || 'live_database') + ' · ' + (meta.db_query_ms || '?') + 'ms' + (payload.count !== undefined ? ' · ' + payload.count + '건' : '') + '</p>' +
    resultHtml +
    '<hr style="margin:24px 0;border:none;border-top:1px solid #eee">' +
    '<p style="font-size:12px;color:#888">JSON: <code>curl https://api.beopmang.org/' + cmd + (args ? '/' + encodeURIComponent(args) : '') + '</code></p>' +
    '<details style="margin-top:8px"><summary style="font-size:12px;color:#888;cursor:pointer">raw JSON</summary><pre>' + escapeHtmlW(resultJson.slice(0, 3000)) + '</pre></details>' +
    '<p style="margin-top:16px;font-size:11px;color:#bbb"><a href="/">api.beopmang.org</a> · 법제처 Open API · 국회 Open API</p>' +
    '</body></html>';
  return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders(), ...rlHeaders } });
}

function escapeHtmlW(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

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
  const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>api.beopmang.org — 법령 검색 API</title><meta name="description" content="대한민국 법령 DB 실시간 쿼리 API. 법률 1,707개, 조문 499K, 판례 171K."><meta property="og:title" content="api.beopmang.org"><meta property="og:description" content="프롬프트 한 줄로 법률AI 에이전트 흉내내기"><meta property="og:type" content="website"><meta property="og:url" content="https://api.beopmang.org"><link rel="canonical" href="https://api.beopmang.org"><link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🦒</text></svg>"><meta property="og:image" content="https://raw.githubusercontent.com/eng-in-law/beopmang-api/main/og.svg">
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
<div class="box"><div class="label">rate limit</div><div class="val">100/min</div></div>
</div>

<div class="row">
<div class="box"><div class="label">법률</div><div class="val">${laws}</div></div>
<div class="box"><div class="label">조문</div><div class="val">${articles}</div></div>
<div class="box"><div class="label">판례</div><div class="val">${cases}</div></div>
</div>

<hr>
<p style="font-size:13px;color:#333;margin-bottom:12px"><strong>AI 에이전트에서 사용하기</strong> — 아래 텍스트를 복사해서 ChatGPT, Claude 등에 붙여넣으세요.</p>
<div class="copy-wrap"><div class="copy-box" onclick="copyPrompt()" id="prompt-box" style="white-space:pre-wrap;font-size:12px;line-height:1.8">법령 검색 도구를 사용해서 내 질문에 답해줘.

사용법: 아래 URL 패턴에 검색어를 넣어 방문하면 법령 데이터가 HTML 페이지로 표시됩니다.

https://api.beopmang.org/find/{법령명}.html — 법령 찾기 (법령ID 확인용)
https://api.beopmang.org/search/{키워드}.html — 조문 본문 검색
https://api.beopmang.org/law/{법령ID}.html — 법령 상세
https://api.beopmang.org/article/{법령ID}/{조문}.html — 조문 조회
https://api.beopmang.org/history/{법령ID}.html — 개정 연혁
https://api.beopmang.org/xref/{법령ID}.html — 인용관계
https://api.beopmang.org/case/{키워드}.html — 판례 검색
https://api.beopmang.org/case-by-law/{법령ID}.html — 법령별 판례
https://api.beopmang.org/bill/{키워드}.html — 의안 검색
https://api.beopmang.org/timeline/{법령ID}.html — 입법 타임라인

예시: https://api.beopmang.org/find/민법.html 을 방문하면 민법의 법령ID를 확인할 수 있고, 그 ID로 /law/, /history/, /article/ 등을 조회할 수 있습니다.

한글 검색어는 URL에 그대로 넣거나 +로 공백을 대체하세요.

내 질문:</div><button class="copy-btn" onclick="copyPrompt()" id="prompt-copy-btn">copy</button></div>

<hr>
<p style="font-size:12px;color:#555;margin-bottom:8px"><strong>URL 패턴 참고</strong></p>
<pre style="background:#f6f6f6;border:1px solid #eee;padding:10px;border-radius:4px;font-size:12px;margin-bottom:16px;line-height:1.8">법령 찾기:    /find/{법령명}.html          예: /find/민법.html
조문 검색:    /search/{키워드}.html        예: /search/손해배상.html
법령 상세:    /law/{법령ID}.html           예: /law/001706.html
조문 조회:    /article/{법령ID}/{조문}.html 예: /article/001706/제750조.html
연혁:         /history/{법령ID}.html       예: /history/001706.html
인용관계:     /xref/{법령ID}.html          예: /xref/001706.html
판례 검색:    /case/{키워드}.html          예: /case/불법행위.html
법령별 판례:  /case-by-law/{법령ID}.html   예: /case-by-law/001706.html
의안 검색:    /bill/{키워드}.html          예: /bill/형법.html
타임라인:     /timeline/{법령ID}.html      예: /timeline/001706.html
DB 현황:      /stats.html

한글은 URL 인코딩하거나 +로 공백 대체. 결과에 다음 단계 링크가 포함되어 있습니다.</pre>

<p style="font-size:12px;color:#555;margin-bottom:8px"><strong>법령 찾기</strong> — 법령명으로 검색해서 시작하세요</p>
<p style="margin-bottom:16px">
<a href="/find/%EB%AF%BC%EB%B2%95.html">민법</a> · <a href="/find/%ED%98%95%EB%B2%95.html">형법</a> · <a href="/find/%EC%83%81%EB%B2%95.html">상법</a> · <a href="/find/%ED%96%89%EC%A0%95%EC%A0%88%EC%B0%A8%EB%B2%95.html">행정절차법</a> · <a href="/find/%EA%B0%9C%EC%9D%B8%EC%A0%95%EB%B3%B4+%EB%B3%B4%ED%98%B8%EB%B2%95.html">개인정보 보호법</a>
</p>

<p style="font-size:12px;color:#555;margin-bottom:8px"><strong>시맨틱 검색</strong> — 자연어 질문으로 법령+판례+제안이유 통합 검색</p>
<p style="margin-bottom:16px">
<a href="/usearch/%EA%B3%84%EC%95%BD+%ED%95%B4%EC%A0%9C.html">계약 해제</a> · <a href="/usearch/%EB%B6%80%EB%8B%B9%ED%95%B4%EA%B3%A0.html">부당해고</a> · <a href="/usearch/%EC%86%90%ED%95%B4%EB%B0%B0%EC%83%81+%EC%B1%85%EC%9E%84.html">손해배상 책임</a>
</p>

<p style="font-size:12px;color:#555;margin-bottom:8px"><strong>조문 검색</strong> — 조문 본문에서 키워드 검색</p>
<p style="margin-bottom:16px">
<a href="/search/%EB%B0%9C%EC%82%AC%ED%97%88%EA%B0%80.html">발사허가</a> · <a href="/search/%EC%9C%84%ED%97%98%EB%AC%BC.html">위험물</a>
</p>

<p style="font-size:12px;color:#555;margin-bottom:8px"><strong>판례</strong></p>
<p style="margin-bottom:16px">
<a href="/case/%EB%B6%88%EB%B2%95%ED%96%89%EC%9C%84.html">불법행위 판례 검색</a> · <a href="/case-by-law/001706.html">민법 관련 판례</a>
</p>

<p style="font-size:12px;color:#555;margin-bottom:8px"><strong>의안</strong></p>
<p style="margin-bottom:16px">
<a href="/bill/%ED%98%95%EB%B2%95.html">형법 관련 의안</a> · <a href="/bill/%EB%AF%BC%EB%B2%95.html">민법 관련 의안</a>
</p>

<p style="font-size:12px;color:#555;margin-bottom:8px"><strong>기타</strong></p>
<p style="margin-bottom:16px">
<a href="/stats.html">DB 현황</a> · <a href="/health">서버 상태</a>
</p>

<p class="note">각 결과 페이지에서 [법령정보] [연혁] [인용관계] [판례] [타임라인] 링크를 따라 깊이 탐색할 수 있습니다.<br><code>?full=1</code>을 붙이면 전체 데이터 표시.</p>

<hr>
<p style="font-size:13px"><a href="/.well-known/agent.json">agent.json</a> · <a href="/openapi.json">openapi.json</a><span class="tag">JSON API</span></p>

<hr>
<p class="note">데이터 출처: 법제처 Open API · 국회 Open API<br>매주 일요일 03:00 KST 갱신. 이 API의 출력은 참고용이며 법적 효력이 없습니다.</p>

<script>
function copyUrl(){
  navigator.clipboard.writeText('https://api.beopmang.org').then(function(){
    document.getElementById('copy-btn').textContent='copied!';
    setTimeout(function(){document.getElementById('copy-btn').textContent='copy'},1500);
  });
}
function copyPrompt(){
  navigator.clipboard.writeText(document.getElementById('prompt-box').textContent).then(function(){
    document.getElementById('prompt-copy-btn').textContent='copied!';
    setTimeout(function(){document.getElementById('prompt-copy-btn').textContent='copy'},1500);
  });
}
</script>
</body></html>`;
  return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders(), ...rlHeaders } });
}
