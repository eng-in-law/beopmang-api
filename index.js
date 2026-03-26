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

    // Feedback endpoint
    if (path === '/feedback' && request.method === 'POST') {
      try {
        const body = await request.json();
        const msg = (body.message || '').slice(0, 1000);
        if (!msg) return json({ ok: false, error: 'message required' }, 400);
        const entry = { message: msg, type: body.type || 'general', context: body.context || '', ip, ts: new Date().toISOString() };
        await env.API_KV.put('fb:' + Date.now() + ':' + Math.random().toString(36).slice(2, 6), JSON.stringify(entry), { expirationTtl: 86400 * 90 });
        return json({ ok: true, message: 'feedback received' });
      } catch { return json({ ok: false, error: 'invalid request' }, 400); }
    }
    if (path === '/feedback' && request.method === 'GET') {
      const secret = (request.headers.get('Authorization') || '').replace('Bearer ', '');
      if (!secret || secret !== env.FEEDBACK_KEY) return json({ ok: false, error: 'unauthorized' }, 401);
      const list = await env.API_KV.list({ prefix: 'fb:', limit: 50 });
      const items = [];
      for (const key of list.keys) {
        const val = await env.API_KV.get(key.name);
        if (val) try { items.push(JSON.parse(val)); } catch {}
      }
      return json({ ok: true, count: items.length, feedback: items });
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
        const VALID_INCLUDES = { history: 'history', xref: 'xref', cases: 'case-by-law', bills: 'bill', timeline: 'timeline', explore: 'explore' };
        const incFields = includeParam.split(',').map(s => s.trim()).filter(f => VALID_INCLUDES[f]);
        const incMap = VALID_INCLUDES;
        included = {};
        for (const f of incFields) {
          if (!incMap[f]) continue;
          const cmd = incMap[f];
          const a = f === 'bills' ? (typeof result === 'object' && !Array.isArray(result) ? result?.law_name : '') || lawId : lawId;
          const qs = 'cmd=' + encodeURIComponent(cmd) + '&args=' + encodeURIComponent(a) + '&json=1';
          try {
            const r = await fetch(env.ORIGIN_BASE + '/api/lawcli?' + qs, { headers: { 'User-Agent': 'beopmang-api/1.0' } });
            const d = await r.json();
            if (d.exit_code === 0) { try { included[f] = JSON.parse(d.output); } catch { included[f] = d.output; } }
          } catch {}
        }
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
  const html = `<!DOCTYPE html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>법망 API 랜딩</title>
    <meta
      name="description"
      content="프롬프트 한 줄로 법률AI 에이전트 흉내내기. 법망 API 랜딩페이지."
    />
    <script src='https://cdn.tailwindcss.com'></script>
    <script>
      tailwind.config = {
        theme: {
          extend: {
            colors: {
              parchment: {
                bg: "#f2ead3",
                card: "#fffdf7",
                border: "#c2a676",
                text: "#3b2f20",
                amber: "#9b7c4d",
              },
            },
            fontFamily: {
              sans: ["Pretendard", "system-ui", "sans-serif"],
              mono: ["JetBrains Mono", "monospace"],
            },
            boxShadow: {
              parchment:
                "0 18px 60px rgba(59, 47, 32, 0.10), inset 0 1px 0 rgba(255,255,255,0.8)",
            },
          },
        },
      };
    </script>
    <link
      rel="stylesheet"
      href="https://cdn.jsdelivr.net/npm/pretendard/dist/web/static/pretendard.css"
    />
    <link
      rel="stylesheet"
      href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=swap"
    />
    <style>
      ::selection {
        background: rgba(155, 124, 77, 0.18);
      }

      body {
        background:
          radial-gradient(circle at top left, rgba(255, 253, 247, 0.95), transparent 34%),
          linear-gradient(180deg, #f8f1df 0%, #f2ead3 48%, #eee3c7 100%);
      }

      .paper-grid {
        background-image:
          linear-gradient(rgba(194, 166, 118, 0.12) 1px, transparent 1px),
          linear-gradient(90deg, rgba(194, 166, 118, 0.12) 1px, transparent 1px);
        background-size: 24px 24px;
        background-position: -1px -1px;
      }

      .paper-noise::before {
        content: "";
        position: absolute;
        inset: 0;
        pointer-events: none;
        opacity: 0.15;
        background:
          radial-gradient(circle at 20% 20%, rgba(194, 166, 118, 0.18), transparent 20%),
          radial-gradient(circle at 80% 10%, rgba(155, 124, 77, 0.12), transparent 18%),
          radial-gradient(circle at 70% 80%, rgba(194, 166, 118, 0.12), transparent 18%);
      }
    </style>
  </head>
  <body class="min-h-screen font-sans text-parchment-text antialiased">
    <main class="relative overflow-hidden px-4 py-8 sm:px-6 lg:px-8">
      <div class="mx-auto max-w-7xl">
        <section
          class="paper-noise paper-grid relative overflow-hidden rounded-[32px] border border-parchment-border/80 bg-parchment-card shadow-parchment"
        >
          <div class="relative border-b border-parchment-border/70 px-6 py-5 sm:px-8">
            <div class="flex flex-wrap items-center justify-between gap-4 text-sm">
              <div class="flex items-center gap-3">
                <span
                  class="inline-flex items-center rounded-full border border-parchment-border bg-parchment-bg px-3 py-1 font-mono text-[12px] font-medium uppercase tracking-[0.18em] text-parchment-amber"
                  >Beopmang API</span
                >
                <span class="text-parchment-text/65">대한민국 법률 데이터 API</span>
              </div>
            </div>
          </div>

          <div class="relative px-6 pb-10 pt-10 sm:px-8 lg:px-12 lg:pb-14 lg:pt-14">
            <section class="grid gap-8 lg:grid-cols-[1.2fr_0.8fr] lg:items-end">
              <div class="max-w-3xl">
                <h1 class="max-w-3xl text-4xl font-black leading-tight tracking-[-0.04em] sm:text-5xl lg:text-6xl">
                  🦒 법망 API
                </h1>
                <p class="mt-4 max-w-2xl text-lg leading-8 text-parchment-text/80 sm:text-xl">
                  프롬프트 한 줄로 법률AI 에이전트 흉내내기
                </p>
                <p class="mt-6 max-w-2xl text-base leading-8 text-parchment-text/72">
                  민법을 찾고, 조문을 펼치고, 판례와 인용관계를 끌어오는 흐름을
                  브라우저와 에이전트에서 바로 시험할 수 있는 얇은 인터페이스입니다.
                </p>
              </div>

            </section>

            <section class="mt-10 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <article class="rounded-[22px] border border-parchment-border bg-parchment-card p-5">
                <p class="font-mono text-xs uppercase tracking-[0.22em] text-parchment-amber">법률</p>
                <p class="mt-3 text-4xl font-black tracking-[-0.04em]">1,707</p>
                <p class="mt-2 text-sm text-parchment-text/65">대한민국 법률 단위 수록</p>
              </article>
              <article class="rounded-[22px] border border-parchment-border bg-parchment-card p-5">
                <p class="font-mono text-xs uppercase tracking-[0.22em] text-parchment-amber">조문</p>
                <p class="mt-3 text-4xl font-black tracking-[-0.04em]">499,310</p>
                <p class="mt-2 text-sm text-parchment-text/65">조·항·호·목 구조 포함</p>
              </article>
              <article class="rounded-[22px] border border-parchment-border bg-parchment-card p-5">
                <p class="font-mono text-xs uppercase tracking-[0.22em] text-parchment-amber">판례</p>
                <p class="mt-3 text-4xl font-black tracking-[-0.04em]">171,257</p>
                <p class="mt-2 text-sm text-parchment-text/65">법령 연계 판례 탐색 가능</p>
              </article>
              <article class="rounded-[22px] border border-parchment-border bg-parchment-card p-5">
                <p class="font-mono text-xs uppercase tracking-[0.22em] text-parchment-amber">인용관계</p>
                <p class="mt-3 text-4xl font-black tracking-[-0.04em]">61,755</p>
                <p class="mt-2 text-sm text-parchment-text/65">법령 간 참조 흐름 추적</p>
              </article>
            </section>

            <section class="mt-14">
              <div class="flex items-end justify-between gap-4">
                <div>
                  <p class="font-mono text-xs uppercase tracking-[0.24em] text-parchment-amber">Use With</p>
                  <h2 class="mt-2 text-2xl font-black tracking-[-0.03em] sm:text-3xl">사용하기</h2>
                </div>
                <p class="hidden text-sm text-parchment-text/65 sm:block">
                  복사해서 바로 붙여넣는 용도에 맞춘 카드
                </p>
              </div>

              <div class="mt-6 grid gap-4 lg:grid-cols-3">
                <article class="rounded-[24px] border border-parchment-border bg-parchment-bg/88 p-6">
                  <div class="flex items-center justify-between gap-3">
                    <h3 class="text-xl font-bold">Claude</h3>
                    <span class="rounded-full border border-parchment-border px-2.5 py-1 font-mono text-xs text-parchment-amber">copy url</span>
                  </div>
                  <p class="mt-4 text-sm leading-7 text-parchment-text/75">
                    URL만 복사해 대화에 붙여넣고, “이 API를 써서 민법 제750조를 정리해줘”처럼 설명을 덧붙이면 됩니다.
                  </p>
                  <button
                    type="button"
                    data-copy="https://api.beopmang.org"
                    class="copy-trigger mt-5 flex w-full items-center justify-between rounded-2xl border border-parchment-border bg-parchment-card px-4 py-3 text-left transition hover:-translate-y-0.5 hover:border-parchment-amber hover:shadow-sm"
                  >
                    <span class="font-mono text-sm">https://api.beopmang.org</span>
                    <span class="rounded-full bg-parchment-bg px-3 py-1 font-mono text-xs uppercase tracking-[0.18em] text-parchment-amber">copy</span>
                  </button>
                </article>

                <article class="rounded-[24px] border border-parchment-border bg-parchment-bg/88 p-6">
                  <div class="flex items-center justify-between gap-3">
                    <h3 class="text-xl font-bold">ChatGPT</h3>
                    <span class="rounded-full border border-parchment-border px-2.5 py-1 font-mono text-xs text-parchment-amber">mcp</span>
                  </div>
                  <p class="mt-4 text-sm leading-7 text-parchment-text/75">
                    MCP URL을 복사한 뒤 ChatGPT의 개발자 설정에서 커넥터 또는 MCP 서버를 추가할 때 붙여넣으면 됩니다.
                  </p>
                  <button
                    type="button"
                    data-copy="https://api.beopmang.org/mcp"
                    class="copy-trigger mt-5 flex w-full items-center justify-between rounded-2xl border border-parchment-border bg-parchment-card px-4 py-3 text-left transition hover:-translate-y-0.5 hover:border-parchment-amber hover:shadow-sm"
                  >
                    <span class="font-mono text-sm">https://api.beopmang.org/mcp</span>
                    <span class="rounded-full bg-parchment-bg px-3 py-1 font-mono text-xs uppercase tracking-[0.18em] text-parchment-amber">copy</span>
                  </button>
                  <p class="mt-4 text-sm leading-7 text-parchment-text/68">
                    인증은 없음. 이름은 <span class="font-mono">법망</span> 정도로 두면 구분이 쉽습니다.
                  </p>
                </article>

                <article class="rounded-[24px] border border-parchment-border bg-parchment-bg/88 p-6">
                  <div class="flex items-center justify-between gap-3">
                    <h3 class="text-xl font-bold">Gemini</h3>
                    <span class="rounded-full border border-parchment-border px-2.5 py-1 font-mono text-xs text-parchment-amber">warning</span>
                  </div>
                  <p class="mt-4 text-sm leading-7 text-parchment-text/75">
                    환각 경향이 커서 이 페이지 기준 사용을 권장하지 않습니다.
                  </p>
                  <div
                    class="mt-5 rounded-2xl border border-dashed border-parchment-border bg-parchment-card px-4 py-4 text-sm font-semibold text-parchment-text"
                  >
                    사용불가
                  </div>
                </article>
              </div>
            </section>

            <section class="mt-14">
              <div class="flex items-end justify-between gap-4">
                <div>
                  <p class="font-mono text-xs uppercase tracking-[0.24em] text-parchment-amber">Try In Browser</p>
                  <h2 class="mt-2 text-2xl font-black tracking-[-0.03em] sm:text-3xl">직접 써보기</h2>
                </div>
                <p class="hidden text-sm text-parchment-text/65 sm:block">\`.html\` 뷰 링크</p>
              </div>

              <div class="mt-6 overflow-hidden rounded-[24px] border border-parchment-border bg-parchment-card">
                <table class="min-w-full text-left text-sm">
                  <thead class="bg-parchment-bg/85">
                    <tr class="border-b border-parchment-border">
                      <th class="px-5 py-4 font-mono text-xs uppercase tracking-[0.18em] text-parchment-amber">Link</th>
                      <th class="px-5 py-4 font-mono text-xs uppercase tracking-[0.18em] text-parchment-amber">Description</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-parchment-border/70">
                    <tr class="transition hover:bg-parchment-bg/55">
                      <td class="px-5 py-4 font-medium">
                        <a class="underline decoration-parchment-border underline-offset-4" href="https://api.beopmang.org/find/%EB%AF%BC%EB%B2%95.html">민법 찾기</a>
                      </td>
                      <td class="px-5 py-4 text-parchment-text/72">법령 검색의 시작점</td>
                    </tr>
                    <tr class="transition hover:bg-parchment-bg/55">
                      <td class="px-5 py-4 font-medium">
                        <a class="underline decoration-parchment-border underline-offset-4" href="https://api.beopmang.org/law/001706.html?full=1">민법 상세정보</a>
                      </td>
                      <td class="px-5 py-4 text-parchment-text/72">법령 메타데이터와 전체 구조 보기</td>
                    </tr>
                    <tr class="transition hover:bg-parchment-bg/55">
                      <td class="px-5 py-4 font-medium">
                        <a class="underline decoration-parchment-border underline-offset-4" href="https://api.beopmang.org/article/001706/%EC%A0%9C750%EC%A1%B0.html">민법 제750조</a>
                      </td>
                      <td class="px-5 py-4 text-parchment-text/72">불법행위 조문 바로 열기</td>
                    </tr>
                    <tr class="transition hover:bg-parchment-bg/55">
                      <td class="px-5 py-4 font-medium">
                        <a class="underline decoration-parchment-border underline-offset-4" href="https://api.beopmang.org/history/001706.html">민법 개정 연혁</a>
                      </td>
                      <td class="px-5 py-4 text-parchment-text/72">제정부터 최근까지 개정 흐름</td>
                    </tr>
                    <tr class="transition hover:bg-parchment-bg/55">
                      <td class="px-5 py-4 font-medium">
                        <a class="underline decoration-parchment-border underline-offset-4" href="https://api.beopmang.org/xref/001706.html">민법 인용관계</a>
                      </td>
                      <td class="px-5 py-4 text-parchment-text/72">인용하는 법과 인용되는 법 추적</td>
                    </tr>
                    <tr class="transition hover:bg-parchment-bg/55">
                      <td class="px-5 py-4 font-medium">
                        <a class="underline decoration-parchment-border underline-offset-4" href="https://api.beopmang.org/case-by-law/001706.html">민법 관련 판례</a>
                      </td>
                      <td class="px-5 py-4 text-parchment-text/72">법령 기반 판례 묶음 보기</td>
                    </tr>
                    <tr class="transition hover:bg-parchment-bg/55">
                      <td class="px-5 py-4 font-medium">
                        <a class="underline decoration-parchment-border underline-offset-4" href="https://api.beopmang.org/bill/%EB%AF%BC%EB%B2%95.html">민법 관련 의안</a>
                      </td>
                      <td class="px-5 py-4 text-parchment-text/72">국회 의안과 개정 흐름 이어보기</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <section class="mt-14">
              <div class="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p class="font-mono text-xs uppercase tracking-[0.24em] text-parchment-amber">Developer API</p>
                  <h2 class="mt-2 text-2xl font-black tracking-[-0.03em] sm:text-3xl">개발자 API</h2>
                </div>
                <p class="max-w-xl text-sm leading-7 text-parchment-text/68">
                  기본 응답은 <span class="font-mono">brief</span> 모드에 맞춰 가볍게 반환하고,
                  필요할 때만 <span class="font-mono">full</span> 또는 <span class="font-mono">include</span>를 얹는 방식입니다.
                </p>
              </div>

              <div class="mt-6 grid gap-4 lg:grid-cols-3">
                <article class="rounded-[22px] border border-parchment-border bg-parchment-bg/88 p-5">
                  <p class="font-mono text-xs uppercase tracking-[0.18em] text-parchment-amber">brief</p>
                  <p class="mt-2 text-sm leading-7 text-parchment-text/76">
                    <span class="font-mono">?brief=1</span> 기본값. 핵심 필드만 반환해서 에이전트와 프롬프트 비용을 줄입니다.
                  </p>
                </article>
                <article class="rounded-[22px] border border-parchment-border bg-parchment-bg/88 p-5">
                  <p class="font-mono text-xs uppercase tracking-[0.18em] text-parchment-amber">full</p>
                  <p class="mt-2 text-sm leading-7 text-parchment-text/76">
                    <span class="font-mono">?full=1</span> 또는 <span class="font-mono">?brief=0</span>. 원본에 가까운 상세 필드를 펼칩니다.
                  </p>
                </article>
                <article class="rounded-[22px] border border-parchment-border bg-parchment-bg/88 p-5">
                  <p class="font-mono text-xs uppercase tracking-[0.18em] text-parchment-amber">include</p>
                  <p class="mt-2 text-sm leading-7 text-parchment-text/76">
                    <span class="font-mono">?include=history,cases,xref,bills,timeline,explore</span> 로 주변 데이터를 병렬 포함합니다.
                  </p>
                </article>
              </div>

              <div class="mt-6 overflow-hidden rounded-[24px] border border-parchment-border bg-parchment-card">
                <table class="min-w-full text-left text-sm">
                  <thead class="bg-parchment-bg/85">
                    <tr class="border-b border-parchment-border">
                      <th class="px-5 py-4 font-mono text-xs uppercase tracking-[0.18em] text-parchment-amber">Endpoint</th>
                      <th class="px-5 py-4 font-mono text-xs uppercase tracking-[0.18em] text-parchment-amber">Purpose</th>
                      <th class="px-5 py-4 font-mono text-xs uppercase tracking-[0.18em] text-parchment-amber">Notes</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-parchment-border/70">
                    <tr class="transition hover:bg-parchment-bg/55">
                      <td class="px-5 py-4 font-mono text-[13px]">GET /find/{법령명}</td>
                      <td class="px-5 py-4">법령명 또는 약칭으로 시작점 찾기</td>
                      <td class="px-5 py-4 text-parchment-text/72">law_id 확보용</td>
                    </tr>
                    <tr class="transition hover:bg-parchment-bg/55">
                      <td class="px-5 py-4 font-mono text-[13px]">GET /law/{id}</td>
                      <td class="px-5 py-4">법령 기본 정보 조회</td>
                      <td class="px-5 py-4 text-parchment-text/72">brief/full/include 대응</td>
                    </tr>
                    <tr class="transition hover:bg-parchment-bg/55">
                      <td class="px-5 py-4 font-mono text-[13px]">GET /article/{id}/{조문}</td>
                      <td class="px-5 py-4">특정 조문 상세 조회</td>
                      <td class="px-5 py-4 text-parchment-text/72">조·항·호·목 포함</td>
                    </tr>
                    <tr class="transition hover:bg-parchment-bg/55">
                      <td class="px-5 py-4 font-mono text-[13px]">GET /search/{키워드}</td>
                      <td class="px-5 py-4">조문 본문 키워드 검색</td>
                      <td class="px-5 py-4 text-parchment-text/72">brief 모드 기본</td>
                    </tr>
                    <tr class="transition hover:bg-parchment-bg/55">
                      <td class="px-5 py-4 font-mono text-[13px]">GET /history/{id}</td>
                      <td class="px-5 py-4">개정 연혁 조회</td>
                      <td class="px-5 py-4 text-parchment-text/72">revision 흐름 확인</td>
                    </tr>
                    <tr class="transition hover:bg-parchment-bg/55">
                      <td class="px-5 py-4 font-mono text-[13px]">GET /xref/{id}</td>
                      <td class="px-5 py-4">법령 간 인용관계 조회</td>
                      <td class="px-5 py-4 text-parchment-text/72">61,755 인용관계 기반</td>
                    </tr>
                    <tr class="transition hover:bg-parchment-bg/55">
                      <td class="px-5 py-4 font-mono text-[13px]">GET /case-by-law/{id}</td>
                      <td class="px-5 py-4">법령별 관련 판례 조회</td>
                      <td class="px-5 py-4 text-parchment-text/72">판례 171,257 연결</td>
                    </tr>
                    <tr class="transition hover:bg-parchment-bg/55">
                      <td class="px-5 py-4 font-mono text-[13px]">GET /bill/{키워드}</td>
                      <td class="px-5 py-4">국회 의안 검색</td>
                      <td class="px-5 py-4 text-parchment-text/72">입법 흐름 보조</td>
                    </tr>
                    <tr class="transition hover:bg-parchment-bg/55">
                      <td class="px-5 py-4 font-mono text-[13px]">GET /timeline/{id}</td>
                      <td class="px-5 py-4">의안·개정·판례 타임라인</td>
                      <td class="px-5 py-4 text-parchment-text/72">법령 중심 흐름 정리</td>
                    </tr>
                    <tr class="transition hover:bg-parchment-bg/55">
                      <td class="px-5 py-4 font-mono text-[13px]">POST /mcp</td>
                      <td class="px-5 py-4">MCP 서버 엔드포인트</td>
                      <td class="px-5 py-4 text-parchment-text/72">ChatGPT 연결용</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <footer class="mt-14 border-t border-parchment-border/75 pt-6">
              <div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                <a class="underline decoration-parchment-border underline-offset-4" href="https://api.beopmang.org/openapi.json">OpenAPI</a>
                <a class="underline decoration-parchment-border underline-offset-4" href="https://api.beopmang.org/.well-known/agent.json">AgentCard</a>
                <a class="underline decoration-parchment-border underline-offset-4" href="https://api.beopmang.org/privacy">Privacy</a>
              </div>
              <p class="mt-4 max-w-3xl text-sm leading-7 text-parchment-text/68">
                데이터 출처는 공개 법령·의안 데이터이며, 본 페이지와 API 출력은 참고용입니다.
                법률 자문이나 공식 해석을 대체하지 않으며 법적 효력을 보장하지 않습니다.
              </p>
            </footer>
          </div>
        </section>
      </div>
    </main>

    <script>
      document.querySelectorAll(".copy-trigger").forEach(function (button) {
        button.addEventListener("click", async function () {
          var value = button.getAttribute("data-copy");
          var badge = button.querySelector("span:last-child");
          try {
            await navigator.clipboard.writeText(value);
            if (badge) {
              var original = badge.textContent;
              badge.textContent = "copied";
              setTimeout(function () {
                badge.textContent = original;
              }, 1400);
            }
          } catch (error) {
            window.prompt("복사할 값을 수동으로 복사하세요.", value);
          }
        });
      });
    </script>
  </body>
</html>
`;
  return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders(), ...rlHeaders } });
}

// ──────────────────────────────────────
// MCP Server (JSON-RPC 2.0 / Streamable HTTP)
// ──────────────────────────────────────

// Command routing table (internal)
const CMD_MAP = {
  findLaw: 'law', getLaw: 'law', getHistory: 'history', getArticle: 'article',
  getXref: 'xref', searchArticles: 'search', searchCases: 'case',
  getCasesByLaw: 'case-by-law', getCaseDetail: 'case-view', searchBills: 'bill',
  getTimeline: 'timeline', exploreLaw: 'explore', getStats: 'stats', sendFeedback: '_feedback',
};

// Single MCP tool
const MCP_TOOLS = [{
  name: '법망',
  description: `대한민국 법령 DB 실시간 쿼리. 반드시 여러 번 호출하고 조문번호와 법령명을 구체적으로 인용하여 답하세요.

명령어 (command 필드에 입력):
- findLaw: 법령 찾기. params: {query: "민법"}. 결과의 law_id로 다른 명령 호출.
- exploreLaw: 종합 탐색. 개별 호출 전에 먼저 사용. params: {law_id: "001706"}
- getLaw: 법령 정보. params: {law_id, full?: true, include?: "history,cases,xref"}
- getArticle: 조문 상세. params: {law_id, article_label: "제750조"}
- getHistory: 개정 연혁. params: {law_id}
- getXref: 인용관계. params: {law_id, cited_by?: true}
- searchArticles: 조문 검색. params: {query}
- searchCases: 판례 검색. params: {query}
- getCasesByLaw: 법령별 판례. params: {law_id}
- getCaseDetail: 판례 상세. params: {case_id}
- searchBills: 의안 검색. params: {query}
- getTimeline: 타임라인. params: {law_id}
- getStats: DB 현황. params: {}
- sendFeedback: 피드백. params: {message, type?: "bug|feature|quality"}`,
  inputSchema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: '명령어 (findLaw, exploreLaw, getLaw 등)' },
      params: { type: 'object', description: '명령어별 파라미터' },
    },
    required: ['command'],
  },
}];

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
    // Single tool: extract command + params from arguments
    const args = params?.arguments || {};
    const command = args.command;
    const p = args.params || {};
    if (!command) return mcpErr(id, -32602, 'Missing command. Available: ' + Object.keys(CMD_MAP).join(', '));
    const cmd = CMD_MAP[command];
    if (!cmd) return mcpErr(id, -32602, 'Unknown command: ' + command + '. Available: ' + Object.keys(CMD_MAP).join(', '));

    // Handle sendFeedback locally
    if (command === 'sendFeedback') {
      const msg = (p.message || '').slice(0, 1000);
      if (!msg) return mcpOk(id, { content: [{ type: 'text', text: 'Error: message required' }], isError: true });
      const entry = { message: msg, type: p.type || 'general', context: p.context || '', ts: new Date().toISOString() };
      await env.API_KV.put('fb:' + Date.now() + ':' + Math.random().toString(36).slice(2, 6), JSON.stringify(entry), { expirationTtl: 86400 * 90 });
      return mcpOk(id, { content: [{ type: 'text', text: 'Feedback received. Thank you.' }] });
    }

    // Normalize params
    const lawId = p.law_id ?? p.id ?? '';
    const articleLabel = p.article_label ?? p.label ?? '';
    let cmdArgs = p.query || lawId || p.case_id || '';
    if (cmd === 'article' && lawId && articleLabel) cmdArgs = lawId + ' ' + articleLabel;
    let flags = '';
    if (p.full) flags += '--json';
    if (p.cited_by) flags += (flags ? ' ' : '') + '--cited-by';

    const qs = 'cmd=' + encodeURIComponent(cmd) + '&args=' + encodeURIComponent(cmdArgs) + (flags ? '&flags=' + encodeURIComponent(flags) : '') + '&json=1';

    try {
      const resp = await fetch(env.ORIGIN_BASE + '/api/lawcli?' + qs, { headers: { 'User-Agent': 'beopmang-mcp/1.0' } });
      const data = await resp.json();
      if (data.exit_code !== 0) {
        return mcpOk(id, { content: [{ type: 'text', text: 'Error: ' + (data.output || 'command failed') }], isError: true });
      }
      let mainResult = data.output || '{}';
      // Handle include parameter
      if (p.include) {
        let parsed; try { parsed = JSON.parse(mainResult); } catch { parsed = null; }
        const lawId = parsed?.law_id || (Array.isArray(parsed) && parsed[0]?.law_id) || null;
        if (lawId) {
          const incMap = { history: 'history', xref: 'xref', cases: 'case-by-law', bills: 'bill', timeline: 'timeline', explore: 'explore' };
          const fields = p.include.split(',').map(s => s.trim()).filter(f => incMap[f]);
          const inc = {};
          for (const f of fields) {
            const a = f === 'bills' ? (parsed?.law_name || lawId) : lawId;
            try {
              const r = await fetch(env.ORIGIN_BASE + '/api/lawcli?cmd=' + encodeURIComponent(incMap[f]) + '&args=' + encodeURIComponent(a) + '&json=1', { headers: { 'User-Agent': 'beopmang-mcp/1.0' } });
              const d = await r.json();
              if (d.exit_code === 0) { try { inc[f] = JSON.parse(d.output); } catch { inc[f] = d.output; } }
            } catch {}
          }
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
