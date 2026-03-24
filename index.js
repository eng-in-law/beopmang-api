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

    // MCP endpoint
    if (path === '/mcp' && request.method === 'POST') {
      return handleMcp(request, env);
    }

    const rl = await checkRateLimit(env.API_KV, ip);
    if (!rl.ok) {
      return json({ ok: false, error: 'rate_limit_exceeded', retry_after: rl.reset }, 429, rl.headers);
    }

    if (path === '/privacy') {
      return new Response('<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>Privacy Policy — api.beopmang.org</title></head><body style="font-family:system-ui;max-width:600px;margin:40px auto;padding:0 20px;color:#222;line-height:1.8"><h1 style="font-size:18px">Privacy Policy</h1><p>api.beopmang.org는 대한민국 법령 공개 데이터를 제공하는 API입니다.</p><h2 style="font-size:15px">수집하는 정보</h2><p>이 API는 개인정보를 수집하지 않습니다. 로그인이 없으며, 쿠키를 사용하지 않습니다. 요청 시 IP 주소가 레이트 리밋 목적으로 일시적으로 처리되며, 저장되지 않습니다.</p><h2 style="font-size:15px">데이터 출처</h2><p>법제처 Open API (law.go.kr), 국회 Open API (open.assembly.go.kr)의 공개 데이터를 제공합니다.</p><h2 style="font-size:15px">면책</h2><p>이 API의 출력은 참고용이며 법적 효력이 없습니다.</p><h2 style="font-size:15px">문의</h2><p>eng.in.law@gmail.com</p></body></html>', {
        status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
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

    // include parameter: fetch additional data in parallel
    const includeParam = url.searchParams.get('include') || '';
    let included;
    if (includeParam) {
      const lawId = (typeof result === 'object' && !Array.isArray(result) && result?.law_id) ? result.law_id : (Array.isArray(result) && result[0]?.law_id) ? result[0].law_id : null;
      if (lawId) {
        const incFields = includeParam.split(',').map(s => s.trim()).filter(Boolean);
        const incMap = { history: 'history', xref: 'xref', cases: 'case-by-law', bills: 'bill', timeline: 'timeline', explore: 'explore' };
        const fetches = incFields.filter(f => incMap[f]).map(async f => {
          const cmd = incMap[f];
          const args = f === 'bills' ? (result?.law_name || lawId) : lawId;
          const qs = 'cmd=' + encodeURIComponent(cmd) + '&args=' + encodeURIComponent(args) + '&json=1';
          try {
            const r = await fetch(env.ORIGIN_BASE + '/api/lawcli?' + qs, { headers: { 'User-Agent': 'beopmang-api/1.0' } });
            const d = await r.json();
            if (d.exit_code === 0) { try { return [f, JSON.parse(d.output)]; } catch { return [f, d.output]; } }
            return [f, null];
          } catch { return [f, null]; }
        });
        const results = await Promise.all(fetches);
        included = {};
        for (const [k, v] of results) { if (v !== null) included[k] = v; }
      }
    }

    env.API_KV.put('stats:daily', String((parseInt(await env.API_KV.get('stats:daily') || '0') + 1)), { expirationTtl: 86400 }).catch(() => {});

    const payload = {
      ok: true,
      command: parsed.cmd,
      mode,
      result,
      ...(count !== undefined && { count }),
      ...(included && Object.keys(included).length && { included }),
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
.cp{cursor:pointer;display:block;margin:6px 0;padding:8px 12px;background:#f6f6f6;border:1px solid #e0e0e0;border-radius:4px}.cp:hover{background:#eee}.cp code{color:#111;font-size:13px;font-weight:500}.cp .copy-btn{float:right;background:#222;color:#fff;border:none;border-radius:3px;padding:2px 10px;font-size:11px;cursor:pointer}.cp .copy-btn:hover{background:#444}
</style></head>
<body>
<h1>api.beopmang.org</h1>
<p class="sub">대한민국 법령 실시간 검색 API</p>

<p style="font-size:13px;color:#333;line-height:1.8;margin-bottom:24px">AI가 법령에 근거한 답변을 만들도록 돕습니다.<br>법제처·국회 Open API에서 수집한 법령·판례·의안 데이터를 조문 단위로 파싱하고, 인용관계 그래프 구축 및 벡터 임베딩을 거쳐 PostgreSQL + pgvector에 저장하여 키워드·시맨틱·하이브리드 검색을 제공합니다.</p>

<div class="row">
<div class="box"><div class="label">법률</div><div class="val">${laws}</div></div>
<div class="box"><div class="label">조문</div><div class="val">${articles}</div></div>
<div class="box"><div class="label">판례</div><div class="val">${cases}</div></div>
</div>

<div class="row">
<div class="box"><div class="label">인용관계</div><div class="val">62K</div></div>
<div class="box"><div class="label">국회 의안</div><div class="val">추적 중</div></div>
<div class="box"><div class="label">서버</div><div class="val"><span class="status"></span> online</div></div>
</div>

<hr>
<p style="font-size:13px;color:#333;margin-bottom:12px"><strong>사용하기</strong></p>
<table>
<tr><td><strong>Claude Web</strong></td><td>대화에 <code>https://api.beopmang.org</code> 붙여넣기 — 알아서 호출</td></tr>
<tr><td><strong>Claude Code</strong></td><td>터미널에서 <code>curl https://api.beopmang.org/find/민법</code></td></tr>
<tr><td><strong>ChatGPT</strong></td><td>설정 → 앱 → 고급 설정 → 개발자 모드 → 앱 만들기<br><span class="cp" onclick="cc(this)" data-v="법망">이름: <code>법망</code> <button class="copy-btn">copy</button></span><br><span class="cp" onclick="cc(this)" data-v="https://api.beopmang.org/mcp">URL: <code>https://api.beopmang.org/mcp</code> <button class="copy-btn">copy</button></span><br><span class="cp" onclick="cc(this)" data-v="반드시 여러 번 호출하고 조문번호와 법령명을 구체적으로 인용하여 답하세요">설명: <code>반드시 여러 번 호출하고 조문번호와 법령명을 구체적으로 인용하여 답하세요</code> <button class="copy-btn">copy</button></span><br>인증: 없음 · 사용: 채팅창 "+" → 더 보기 → 법망 선택<br>⚠ Plus 이상 필요 (무료 계정 미지원) · 추천 모델: GPT 5.4 Thinking 경량 추론 이상</td></tr>
</table>

<hr>
<p style="font-size:13px;color:#333;margin-bottom:12px"><strong>직접 써보기</strong></p>
<table>
<tr><td><a href="/find/%EB%AF%BC%EB%B2%95.html">민법 찾기</a></td><td>법령 검색의 시작</td></tr>
<tr><td><a href="/law/001706.html?full=1">민법 상세정보</a></td><td>조문 1,193개</td></tr>
<tr><td><a href="/article/001706/%EC%A0%9C750%EC%A1%B0.html">민법 제750조</a></td><td>불법행위 — 가장 많이 인용되는 조문</td></tr>
<tr><td><a href="/history/001706.html">민법 개정 연혁</a></td><td>제정부터 최근 개정까지</td></tr>
<tr><td><a href="/xref/001706.html">민법 인용관계</a></td><td>민법이 인용하는 법령</td></tr>
<tr><td><a href="/case-by-law/001706.html">민법 관련 판례</a></td><td>대법원 판례</td></tr>
<tr><td><a href="/bill/%EB%AF%BC%EB%B2%95.html">민법 관련 의안</a></td><td>국회 계류 의안</td></tr>
<tr><td><a href="/case/%EB%B6%88%EB%B2%95%ED%96%89%EC%9C%84.html">불법행위 판례 검색</a></td><td>키워드로 판례 검색</td></tr>
</table>

<hr>
<p style="font-size:13px;color:#333;margin-bottom:12px"><strong>개발자용 API</strong></p>
<p style="font-size:12px;color:#555;margin-bottom:8px">모든 엔드포인트는 JSON으로 응답합니다. 인증 없이 무료.</p>
<table>
<tr><td><code>GET /find/{법령명}</code></td><td>법령 찾기</td></tr>
<tr><td><code>GET /law/{id}</code></td><td>법령 정보</td></tr>
<tr><td><code>GET /article/{id}/{조문}</code></td><td>조문 상세</td></tr>
<tr><td><code>GET /history/{id}</code></td><td>개정 연혁</td></tr>
<tr><td><code>GET /xref/{id}</code></td><td>인용관계</td></tr>
<tr><td><code>GET /search/{키워드}</code></td><td>조문 검색</td></tr>
<tr><td><code>GET /case/{키워드}</code></td><td>판례 검색</td></tr>
<tr><td><code>GET /case-by-law/{id}</code></td><td>법령별 판례</td></tr>
<tr><td><code>GET /bill/{키워드}</code></td><td>의안 검색</td></tr>
<tr><td><code>GET /timeline/{id}</code></td><td>입법 타임라인</td></tr>
<tr><td><code>GET /explore/{id}</code></td><td>종합 탐색</td></tr>
<tr><td><code>GET /stats</code></td><td>DB 현황</td></tr>
</table>
<p class="note"><code>?brief=1</code> 요약 (기본) · <code>?full=1</code> 전체 · <code>.html</code> 붙이면 웹페이지로 표시<br>rate limit: ${daily}건 오늘 처리 · 100 req/min per IP</p>

<hr>
<p style="font-size:13px"><a href="/openapi.json">OpenAPI Spec</a> · <a href="/.well-known/agent.json">Agent Card</a> · <a href="/privacy">Privacy</a></p>

<hr>
<p class="note">데이터 출처: 법제처 Open API · 국회 Open API<br>매주 일요일 03:00 KST 갱신. 이 API의 출력은 참고용이며 법적 효력이 없습니다.</p>

<script>function cc(el){var v=el.dataset.v;navigator.clipboard.writeText(v).then(function(){var b=el.querySelector('.copy-btn');if(b){b.textContent='copied!';setTimeout(function(){b.textContent='copy'},1500)}})}</script>
</body></html>`;
  return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders(), ...rlHeaders } });
}

// ──────────────────────────────────────
// MCP Server (JSON-RPC 2.0 / Streamable HTTP)
// ──────────────────────────────────────

const MCP_TOOLS = [
  { name: 'findLaw', description: '법령명/약칭으로 법령 찾기. law_id를 확인한 뒤 exploreLaw로 종합 탐색하세요.', inputSchema: { type: 'object', properties: { query: { type: 'string', description: '법령명 또는 약칭' }, include: { type: 'string', description: '추가 데이터를 함께 반환. 쉼표 구분: history,cases,xref,bills,timeline' } }, required: ['query'] }, cmd: 'law' },
  { name: 'getLaw', description: '법령 기본정보 (소관부처, 시행일, 조문 수)', inputSchema: { type: 'object', properties: { id: { type: 'string', description: '법령 ID (6자리)' }, full: { type: 'boolean', description: '전체 데이터' }, include: { type: 'string', description: '추가 데이터: history,cases,xref,bills,timeline' } }, required: ['id'] }, cmd: 'law' },
  { name: 'getHistory', description: '법령 개정 연혁', inputSchema: { type: 'object', properties: { id: { type: 'string', description: '법령 ID' } }, required: ['id'] }, cmd: 'history' },
  { name: 'getArticle', description: '조문 상세 (항/호/목)', inputSchema: { type: 'object', properties: { id: { type: 'string', description: '법령 ID' }, label: { type: 'string', description: '조문 번호 (예: 제1조)' } }, required: ['id', 'label'] }, cmd: 'article' },
  { name: 'getXref', description: '법령 간 인용관계', inputSchema: { type: 'object', properties: { id: { type: 'string', description: '법령 ID' }, cited_by: { type: 'boolean', description: '피인용 조회' } }, required: ['id'] }, cmd: 'xref' },
  { name: 'searchArticles', description: '조문 본문 키워드 검색', inputSchema: { type: 'object', properties: { query: { type: 'string', description: '검색 키워드' } }, required: ['query'] }, cmd: 'search' },
  { name: 'searchCases', description: '판례 키워드 검색', inputSchema: { type: 'object', properties: { query: { type: 'string', description: '검색 키워드' } }, required: ['query'] }, cmd: 'case' },
  { name: 'getCasesByLaw', description: '특정 법령 관련 판례', inputSchema: { type: 'object', properties: { id: { type: 'string', description: '법령 ID' } }, required: ['id'] }, cmd: 'case-by-law' },
  { name: 'getCaseDetail', description: '판례 상세 (판결요지, 참조조문)', inputSchema: { type: 'object', properties: { case_id: { type: 'string', description: '판례 ID' } }, required: ['case_id'] }, cmd: 'case-view' },
  { name: 'searchBills', description: '국회 의안 검색', inputSchema: { type: 'object', properties: { query: { type: 'string', description: '법률안명 키워드' } }, required: ['query'] }, cmd: 'bill' },
  { name: 'getTimeline', description: '법령 입법 타임라인', inputSchema: { type: 'object', properties: { id: { type: 'string', description: '법령 ID' } }, required: ['id'] }, cmd: 'timeline' },
  { name: 'exploreLaw', description: '법령 종합 탐색. 개별 호출 전에 먼저 사용하세요. 조문 목록, 관련 판례, 의안, 인용관계를 한 번에 반환합니다.', inputSchema: { type: 'object', properties: { id: { type: 'string', description: '법령 ID' } }, required: ['id'] }, cmd: 'explore' },
  { name: 'getStats', description: 'DB 전체 현황', inputSchema: { type: 'object', properties: {} }, cmd: 'stats' },
];

function mcpOk(id, result) {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders() }
  });
}
function mcpErr(id, code, msg) {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message: msg } }), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders() }
  });
}

async function handleMcp(request, env) {
  let body;
  try { body = await request.json(); } catch { return mcpErr(null, -32700, 'Parse error'); }
  const { id, method, params } = body;

  if (method === 'initialize') {
    return mcpOk(id, { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'beopmang-api', version: '1.0.0' } });
  }
  if (method === 'notifications/initialized') {
    return new Response('', { status: 204 });
  }
  if (method === 'tools/list') {
    return mcpOk(id, { tools: MCP_TOOLS.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) });
  }
  if (method === 'tools/call') {
    const toolName = params?.name;
    const args = params?.arguments || {};
    const tool = MCP_TOOLS.find(t => t.name === toolName);
    if (!tool) return mcpErr(id, -32602, 'Unknown tool: ' + toolName);

    // Build origin URL
    let cmdArgs = args.query || args.id || args.case_id || '';
    if (tool.cmd === 'article' && args.id && args.label) cmdArgs = args.id + ' ' + args.label;
    let flags = '';
    if (args.full) flags += '--json';
    if (args.cited_by) flags += (flags ? ' ' : '') + '--cited-by';

    const qs = 'cmd=' + encodeURIComponent(tool.cmd) + '&args=' + encodeURIComponent(cmdArgs) + (flags ? '&flags=' + encodeURIComponent(flags) : '') + '&json=1';

    try {
      const resp = await fetch(env.ORIGIN_BASE + '/api/lawcli?' + qs, { headers: { 'User-Agent': 'beopmang-mcp/1.0' } });
      const data = await resp.json();
      if (data.exit_code !== 0) {
        return mcpOk(id, { content: [{ type: 'text', text: 'Error: ' + (data.output || 'command failed') }], isError: true });
      }
      let mainResult = data.output || '{}';
      // Handle include parameter
      if (args.include) {
        let parsed; try { parsed = JSON.parse(mainResult); } catch { parsed = null; }
        const lawId = parsed?.law_id || (Array.isArray(parsed) && parsed[0]?.law_id) || null;
        if (lawId) {
          const incMap = { history: 'history', xref: 'xref', cases: 'case-by-law', bills: 'bill', timeline: 'timeline', explore: 'explore' };
          const fields = args.include.split(',').map(s => s.trim()).filter(f => incMap[f]);
          const fetches = fields.map(async f => {
            const a = f === 'bills' ? (parsed?.law_name || lawId) : lawId;
            try {
              const r = await fetch(env.ORIGIN_BASE + '/api/lawcli?cmd=' + encodeURIComponent(incMap[f]) + '&args=' + encodeURIComponent(a) + '&json=1', { headers: { 'User-Agent': 'beopmang-mcp/1.0' } });
              const d = await r.json();
              return d.exit_code === 0 ? [f, d.output] : [f, null];
            } catch { return [f, null]; }
          });
          const results = await Promise.all(fetches);
          const inc = {}; for (const [k, v] of results) { if (v) inc[k] = v; }
          mainResult = JSON.stringify({ main: parsed, included: inc }, null, 2);
        }
      }
      return mcpOk(id, { content: [{ type: 'text', text: mainResult }] });
    } catch (e) {
      return mcpOk(id, { content: [{ type: 'text', text: 'Error: ' + e.message }], isError: true });
    }
  }

  return mcpErr(id, -32601, 'Method not found: ' + method);
}
