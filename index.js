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

const REST_ROUTE_MAP = {
  find: 'findLaw',
  law: 'getLaw',
  history: 'getHistory',
  article: 'getArticle',
  xref: 'getXref',
  search: 'searchArticles',
  case: 'searchCases',
  'case-by-law': 'getCasesByLaw',
  'case-view': 'getCaseDetail',
  bill: 'searchBills',
  timeline: 'getTimeline',
  explore: 'exploreLaw',
  stats: 'getStats',
};

const INCLUDE_COMMAND_MAP = {
  history: 'getHistory',
  xref: 'getXref',
  cases: 'getCasesByLaw',
  bills: 'searchBills',
  timeline: 'getTimeline',
  explore: 'exploreLaw',
};

const TOOL_COMMANDS = [
  'findLaw', 'getLaw', 'getHistory', 'getArticle', 'getXref', 'searchArticles',
  'searchCases', 'getCasesByLaw', 'getCaseDetail', 'searchBills', 'getTimeline',
  'exploreLaw', 'getStats', 'sendFeedback'
];

function buildOriginUrl(base, command, p = {}) {
  const lawId = p.law_id || p.id || '';
  const articleLabel = p.article_label || p.label || '';
  if (command === 'findLaw' || command === 'getLaw') {
    return base + '/api/v2/law?q=' + encodeURIComponent(p.query || lawId || '')
      + (p.exact ? '&exact=true' : '')
      + (p.active_only ? '&active_only=true' : '')
      + (p.law_type ? '&law_type=' + encodeURIComponent(p.law_type) : '')
      + (p.limit ? '&limit=' + p.limit : '')
      + (p.full || p.articles ? '&articles=true' : '');
  }
  if (command === 'getArticle') {
    if (!lawId) return null;
    if (!articleLabel && !p.article_path) return null;
    return base + '/api/v2/article?law=' + encodeURIComponent(lawId)
      + (p.article_path ? '&path=' + encodeURIComponent(p.article_path) : '&label=' + encodeURIComponent(articleLabel));
  }
  if (command === 'searchArticles') {
    return base + '/api/v2/search?q=' + encodeURIComponent(p.query || '') + '&top_k=20';
  }
  if (command === 'exploreLaw') {
    return base + '/api/v2/explore?law_id=' + encodeURIComponent(p.law_id || '');
  }
  const cmd = {
    getHistory: 'history',
    getXref: 'xref',
    searchCases: 'case',
    getCasesByLaw: 'case-by-law',
    getCaseDetail: 'case-view',
    searchBills: 'bill',
    getTimeline: 'timeline',
    getStats: 'stats',
  }[command] || command;
  let args = p.query || lawId || p.case_id || '';
  if (command === 'getArticle') args = lawId + ' ' + articleLabel;
  let flags = '';
  if (p.cited_by) flags = '--cited-by';
  return base + '/api/lawcli?cmd=' + encodeURIComponent(cmd)
    + '&args=' + encodeURIComponent(args)
    + (flags ? '&flags=' + encodeURIComponent(flags) : '')
    + '&json=1';
}

function parseOriginOutput(output) {
  try {
    return JSON.parse(output);
  } catch {
    return output;
  }
}

function buildV1ErrorPayload(body, command) {
  const rawDetail = body?.output || '';
  const clean = rawDetail
    .replace(/lawcli\.py/g, 'lawcli')
    .replace(/\/home\/[^\s]+/g, '')
    .replace(/Traceback[\s\S]*$/m, '')
    .trim();
  let errObj;
  try { errObj = JSON.parse(clean); } catch { errObj = null; }
  const errPayload = errObj?.error ? errObj : {
    ok: false,
    error: { code: 'COMMAND_FAILED', message: clean || 'command returned an error', command },
  };
  if (!errPayload.ok) errPayload.ok = false;
  return errPayload;
}

async function fetchOriginNormalized(originUrl, userAgent, command) {
  const httpResp = await fetch(originUrl, {
    headers: { 'User-Agent': userAgent },
    cf: { cacheTtl: 0 },
  });

  let resp = null;
  try { resp = await httpResp.json(); } catch {}

  if (resp && Object.prototype.hasOwnProperty.call(resp, 'data')) {
    return {
      ok: true,
      version: 'v2',
      result: resp.data,
      meta: resp.meta || {},
      raw: resp,
    };
  }

  if (resp && Object.prototype.hasOwnProperty.call(resp, 'exit_code')) {
    if (resp.exit_code !== 0) {
      return {
        ok: false,
        status: 422,
        errorPayload: buildV1ErrorPayload(resp, command),
      };
    }
    return {
      ok: true,
      version: 'v1',
      result: parseOriginOutput(resp.output),
      meta: resp.meta || {},
      raw: resp,
    };
  }

  if (resp?.error) {
    return {
      ok: false,
      status: httpResp.ok ? 422 : httpResp.status,
      errorPayload: resp,
    };
  }

  if (!httpResp.ok) throw new Error('origin ' + httpResp.status);

  return {
    ok: false,
    status: 502,
    errorPayload: { ok: false, error: { code: 'ORIGIN_INVALID_RESPONSE', message: 'unexpected origin response', command } },
  };
}

export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'GET') return handleRequest(request, env);

    const cache = caches.default;
    const cacheKey = new Request(request.url, request);
    const cached = await cache.match(cacheKey);
    if (cached) return cached;

    const response = await handleRequest(request, env);
    if (response.status === 200) {
      const resp = new Response(response.body, response);
      resp.headers.set('Cache-Control', 'public, max-age=60');
      ctx.waitUntil(cache.put(cacheKey, resp.clone()));
      return resp;
    }
    return response;
  }
};

async function handleRequest(request, env) {
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
      return new Response('<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>Privacy Policy — api.beopmang.org</title></head><body style="font-family:system-ui;max-width:600px;margin:40px auto;padding:0 20px;color:#222;line-height:1.8"><h1 style="font-size:18px">Privacy Policy</h1><p>api.beopmang.org는 대한민국 법령 공개 데이터를 제공하는 API입니다.</p><h2 style="font-size:15px">수집하는 정보</h2><p>이 API는 개인정보를 수집하지 않습니다. 로그인이 없으며, 쿠키를 사용하지 않습니다. 요청 시 IP 주소가 레이트 리밋 목적으로 일시적으로 처리되며, 저장되지 않습니다.</p><h2 style="font-size:15px">데이터 출처</h2><p>법제처 Open API (law.go.kr), 국회 Open API (open.assembly.go.kr)의 공개 데이터를 제공합니다.</p><h2 style="font-size:15px">면책</h2><p>이 API의 출력은 참고용이며 법적 효력이 없습니다.</p><h2 style="font-size:15px">문의</h2><p>help@beopmang.org</p></body></html>', {
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

    const originUrl = buildOriginUrl(env.ORIGIN_BASE, parsed.operation, parsed.request);
    if (!originUrl) {
      return json({ ok: false, error: { code: 'INVALID_ARGUMENT', message: 'Missing required parameters', command: parsed.operation } }, 422, rl.headers);
    }
    const cacheKey = `cache:${buildOriginUrl('', parsed.operation, parsed.request)}`;
    const t0 = Date.now();
    let originData;
    let fromCache = false;

    try {
      originData = await fetchOriginNormalized(originUrl, 'beopmang-api/1.0', parsed.operation);
      if (!originData.ok) {
        return json(originData.errorPayload, originData.status, rl.headers);
      }
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

    let result = originData.result;

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
        const VALID_INCLUDES = INCLUDE_COMMAND_MAP;
        const incFields = includeParam.split(',').map(s => s.trim()).filter(f => VALID_INCLUDES[f]);
        included = {};
        for (const f of incFields) {
          const command = VALID_INCLUDES[f];
          if (!command) continue;
          const query = f === 'bills' ? ((typeof result === 'object' && !Array.isArray(result) ? result?.law_name : '') || lawId) : lawId;
          const includeParams = f === 'bills' ? { query } : { law_id: lawId };
          const includeUrl = buildOriginUrl(env.ORIGIN_BASE, command, includeParams);
          try {
            const d = await fetchOriginNormalized(includeUrl, 'beopmang-api/1.0', command);
            if (d.ok) included[f] = d.result;
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
  const route = parts[0];
  const operation = REST_ROUTE_MAP[route];
  if (!operation) return null;

  const pathArgs = parts.slice(1);
  const joinedArgs = pathArgs.join(' ');
  const q = params.get('q');
  const cmd = route === 'find' ? 'law' : route;
  let args = q || joinedArgs || undefined;
  let request = {};

  switch (operation) {
    case 'findLaw':
      request = {
        query: q || joinedArgs,
        exact: params.get('exact') === '1' || params.get('exact') === 'true',
        active_only: params.get('active_only') === '1' || params.get('active_only') === 'true',
        law_type: params.get('law_type'),
        limit: params.get('limit'),
        full: params.get('full') === '1' || params.get('full') === 'true',
        articles: params.get('articles') === '1' || params.get('articles') === 'true',
      };
      break;
    case 'getLaw':
      request = {
        law_id: q || joinedArgs,
        full: params.get('full') === '1' || params.get('full') === 'true',
        articles: params.get('articles') === '1' || params.get('articles') === 'true',
      };
      break;
    case 'getHistory':
    case 'getXref':
    case 'getCasesByLaw':
    case 'getTimeline':
    case 'exploreLaw':
      request = { law_id: q || joinedArgs };
      break;
    case 'getArticle':
      args = pathArgs.filter(Boolean).join(' ') || undefined;
      request = {
        law_id: pathArgs[0] || '',
        article_label: pathArgs[1] || '',
        article_path: params.get('path'),
      };
      break;
    case 'searchArticles':
      request = { query: q || joinedArgs, top_k: params.get('top_k') || params.get('top-k') || 20 };
      break;
    case 'searchCases':
    case 'searchBills':
      request = { query: q || joinedArgs };
      break;
    case 'getCaseDetail':
      request = { case_id: q || joinedArgs };
      break;
    case 'getStats':
      args = undefined;
      request = {};
      break;
    default:
      request = {};
  }

  if (operation === 'getXref') request.cited_by = params.get('cited-by') === '1';

  return { cmd, route, operation, args, request, forceHtml };
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
<html lang="ko" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>법망 API</title>
<meta name="description" content="프롬프트 한 줄로 법률AI 에이전트 흉내내기">
<meta property="og:title" content="법망 API">
<meta property="og:description" content="프롬프트 한 줄로 법률AI 에이전트 흉내내기">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🦒</text></svg>">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.classless.min.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/pretendard/dist/web/static/pretendard.css">
<style>
:root {
  --pico-font-family: "Pretendard", system-ui, sans-serif;
  --pico-background-color: #f2ead3;
  --pico-card-background-color: #fffdf7;
  --pico-card-border-color: #c2a676;
  --pico-primary: #9b7c4d;
  --pico-primary-hover: #86673d;
  --pico-primary-focus: rgba(155, 124, 77, 0.2);
  --pico-color: #3b2f20;
  --pico-muted-color: #6a5639;
  --pico-muted-border-color: rgba(194, 166, 118, 0.45);
  --pico-code-background-color: rgba(155, 124, 77, 0.08);
  --pico-code-color: #3b2f20;
  --pico-code-font-family: ui-monospace, "SFMono-Regular", "JetBrains Mono", monospace;
  --pico-line-height: 1.55;
  --pico-border-radius: 1.25rem;
  --paper-shadow: 0 18px 50px rgba(90, 64, 26, 0.12);
  --section-shadow: 0 8px 28px rgba(90, 64, 26, 0.07);
}

* {
  box-sizing: border-box;
}

html {
  scroll-behavior: smooth;
}

body {
  margin: 0;
  color: #3b2f20;
  background:
    radial-gradient(circle at top left, rgba(255, 253, 247, 0.9), transparent 30rem),
    radial-gradient(circle at bottom right, rgba(194, 166, 118, 0.14), transparent 24rem),
    linear-gradient(180deg, #f8f1de 0%, #f2ead3 18%, #efe4c9 100%);
}

body::before {
  content: "";
  position: fixed;
  inset: 0;
  pointer-events: none;
  background-image:
    linear-gradient(rgba(155, 124, 77, 0.03) 1px, transparent 1px),
    linear-gradient(90deg, rgba(155, 124, 77, 0.025) 1px, transparent 1px);
  background-size: 100% 2.25rem, 2.25rem 100%;
  mask-image: linear-gradient(180deg, rgba(0, 0, 0, 0.34), transparent 90%);
}

a {
  color: inherit;
  text-decoration-thickness: 1px;
  text-underline-offset: 0.18em;
}

button {
  margin: 0;
  border-radius: 999px;
  border: 1px solid rgba(194, 166, 118, 0.9);
  background: linear-gradient(180deg, #fffdf7 0%, #f7efd9 100%);
  color: #3b2f20;
  box-shadow: none;
  transition: transform 180ms ease, border-color 180ms ease, background-color 180ms ease, box-shadow 180ms ease;
}

button:hover,
button:focus-visible {
  transform: translateY(-1px);
  border-color: #9b7c4d;
  box-shadow: 0 10px 24px rgba(155, 124, 77, 0.14);
}

code {
  border-radius: 999px;
  padding: 0.35rem 0.75rem;
}

main {
  display: block;
}

.shell {
  width: min(1120px, calc(100% - 2rem));
  margin: 0 auto;
}

.hero {
  position: relative;
  min-height: 100svh;
  display: grid;
  align-items: center;
  padding: 1.2rem 0 4rem;
}

.hero::after {
  content: "";
  position: absolute;
  inset: auto 0 0;
  height: 7rem;
  background: linear-gradient(180deg, rgba(242, 234, 211, 0) 0%, rgba(242, 234, 211, 0.96) 70%, #f2ead3 100%);
  pointer-events: none;
}

.hero-grid {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(300px, 0.95fr);
  gap: 3rem;
  align-items: center;
}

.hero-copy {
  max-width: 38rem;
  padding: 2rem 0;
  animation: rise 680ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
}

.hero h1 {
  margin: 0 0 0.8rem;
  font-size: clamp(3rem, 8vw, 6.2rem);
  line-height: 0.95;
  letter-spacing: -0.06em;
}

.hero p {
  margin: 0;
  max-width: 24rem;
  font-size: clamp(1.05rem, 2vw, 1.35rem);
  color: #5f4a2f;
}

.hero-visual {
  position: relative;
  min-height: 34rem;
  display: grid;
  place-items: center;
  animation: rise 860ms cubic-bezier(0.2, 0.7, 0.2, 1) 120ms both;
}

.orbital {
  position: absolute;
  inset: 8% 2% auto auto;
  width: min(34rem, 100%);
  aspect-ratio: 1;
  border-radius: 50%;
  background:
    radial-gradient(circle at 50% 50%, rgba(255, 253, 247, 0.98) 0%, rgba(255, 253, 247, 0.76) 32%, rgba(194, 166, 118, 0.16) 33%, rgba(194, 166, 118, 0.16) 35%, transparent 36%),
    radial-gradient(circle at 50% 50%, rgba(155, 124, 77, 0.18) 0%, rgba(155, 124, 77, 0.08) 42%, transparent 66%);
  filter: drop-shadow(0 36px 60px rgba(120, 84, 39, 0.18));
  animation: drift 9s ease-in-out infinite;
}

.orbital::before,
.orbital::after {
  content: "";
  position: absolute;
  border-radius: 50%;
  border: 1px solid rgba(155, 124, 77, 0.22);
}

.orbital::before {
  inset: 9%;
}

.orbital::after {
  inset: 21%;
}

.giraffe-seal {
  position: relative;
  z-index: 1;
  width: min(24rem, 75%);
  aspect-ratio: 1;
  border-radius: 50%;
  display: grid;
  place-items: center;
  padding: 2rem;
  text-align: center;
  background:
    linear-gradient(180deg, rgba(255, 253, 247, 0.96), rgba(250, 241, 219, 0.92)),
    rgba(255, 253, 247, 0.9);
  border: 1px solid rgba(194, 166, 118, 0.9);
  box-shadow: var(--paper-shadow);
}

.giraffe-seal::before {
  content: "";
  position: absolute;
  inset: 0.85rem;
  border-radius: 50%;
  border: 1px dashed rgba(155, 124, 77, 0.36);
}

.seal-mark {
  font-size: clamp(4rem, 9vw, 6rem);
  line-height: 1;
}

.hero-stats {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  transform: translateY(24%);
}

.stat-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0;
  padding: 0.4rem;
  background: rgba(255, 253, 247, 0.82);
  backdrop-filter: blur(14px);
  border: 1px solid rgba(194, 166, 118, 0.75);
  border-radius: 1.6rem;
  box-shadow: var(--paper-shadow);
  animation: rise 900ms cubic-bezier(0.2, 0.7, 0.2, 1) 240ms both;
}

.stat {
  padding: 1.2rem 1rem 1rem;
  text-align: center;
  position: relative;
}

.stat + .stat::before {
  content: "";
  position: absolute;
  left: 0;
  top: 22%;
  bottom: 22%;
  width: 1px;
  background: rgba(194, 166, 118, 0.52);
}

.stat strong {
  display: block;
  font-size: clamp(1.35rem, 3vw, 2.15rem);
  letter-spacing: -0.04em;
}

.stat span {
  display: block;
  margin-top: 0.25rem;
  color: #6a5639;
  font-size: 0.84rem;
}

.content {
  padding: 7rem 0 3rem;
}

.document {
  position: relative;
  padding: clamp(1.4rem, 3vw, 2rem);
  background:
    linear-gradient(180deg, rgba(255, 253, 247, 0.94), rgba(255, 251, 242, 0.96)),
    #fffdf7;
  border: 1px solid rgba(194, 166, 118, 0.82);
  border-radius: 2rem;
  box-shadow: var(--section-shadow);
}

.document::before {
  content: "";
  position: absolute;
  inset: 1rem;
  border: 1px solid rgba(194, 166, 118, 0.34);
  border-radius: 1.5rem;
  pointer-events: none;
}

.usage-header {
  position: relative;
  z-index: 1;
  margin-bottom: 2rem;
}

.usage-header h2 {
  margin: 0;
  font-size: clamp(2rem, 3vw, 3rem);
  letter-spacing: -0.05em;
}

.usage-flow {
  position: relative;
  z-index: 1;
  display: grid;
  gap: 1rem;
}

.channel {
  position: relative;
  padding: 1.3rem 1.35rem 1.4rem;
  border-radius: 1.4rem;
  border: 1px solid rgba(194, 166, 118, 0.72);
  background:
    linear-gradient(180deg, rgba(255, 253, 247, 0.98), rgba(250, 241, 219, 0.62));
  box-shadow: 0 10px 24px rgba(90, 64, 26, 0.05);
  overflow: hidden;
}

.channel::after {
  content: "";
  position: absolute;
  inset: 0 auto 0 0;
  width: 0.32rem;
  background: linear-gradient(180deg, rgba(155, 124, 77, 0.9), rgba(155, 124, 77, 0.22));
}

.channel-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.9rem;
}

.channel-head h3 {
  margin: 0;
  font-size: 1.18rem;
}

.channel p {
  margin: 0.75rem 0 0;
  color: #5f4a2f;
}

.copy-line {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.75rem;
  align-items: center;
}

.field-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 0.75rem;
  align-items: center;
}

.field-row strong {
  font-size: 0.88rem;
  white-space: nowrap;
}

.copy-line code,
.field-row code {
  display: inline-flex;
  align-items: center;
  min-height: 2.6rem;
  width: 100%;
  padding-inline: 0.9rem;
  overflow-wrap: anywhere;
}

.copy-line button,
.field-row button {
  min-width: 4.75rem;
  padding: 0.55rem 0.8rem;
  font-size: 0.82rem;
}

.steps {
  display: grid;
  gap: 0.9rem;
  list-style: none;
  padding: 0;
  margin: 1rem 0 0;
}

.steps li {
  position: relative;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 1rem;
  padding: 1rem 1rem 1rem 0.1rem;
  border-top: 1px solid rgba(194, 166, 118, 0.38);
  transition: transform 220ms ease, border-color 220ms ease;
}

.steps li:first-child {
  border-top: 0;
  padding-top: 0.2rem;
}

.steps li:hover,
.steps li:focus-within {
  transform: translateX(0.2rem);
  border-color: rgba(155, 124, 77, 0.64);
}

.step-no {
  width: 2.4rem;
  height: 2.4rem;
  display: grid;
  place-items: center;
  border-radius: 999px;
  border: 1px solid rgba(194, 166, 118, 0.82);
  background: rgba(255, 253, 247, 0.92);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.step-body {
  display: grid;
  gap: 0.85rem;
  min-width: 0;
}

.step-body p {
  margin: 0;
}

.field-grid {
  display: grid;
  gap: 0.65rem;
}

.field-row em {
  font-style: normal;
  color: #6a5639;
}

.static-line {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: #5f4a2f;
}

.static-line strong {
  font-size: 0.88rem;
}

.footer {
  padding: 2rem 0 3rem;
}

.footer-block {
  padding: 1.2rem 0 0;
  border-top: 1px solid rgba(194, 166, 118, 0.55);
  color: #6a5639;
  font-size: 0.88rem;
}

.footer-block p {
  margin: 0;
}

.footer-block p + p {
  margin-top: 0.55rem;
}

.footer-nav {
  font-size: 0.92rem;
}

@keyframes drift {
  0%,
  100% {
    transform: translate3d(0, 0, 0) scale(1);
  }
  50% {
    transform: translate3d(0, -0.7rem, 0) scale(1.015);
  }
}

@keyframes rise {
  from {
    opacity: 0;
    transform: translate3d(0, 1.4rem, 0);
  }
  to {
    opacity: 1;
    transform: translate3d(0, 0, 0);
  }
}

@media (prefers-reduced-motion: reduce) {
  html {
    scroll-behavior: auto;
  }

  *,
  *::before,
  *::after {
    animation: none !important;
    transition: none !important;
  }
}

@media (max-width: 900px) {
  .hero {
    min-height: auto;
    padding-top: 1rem;
  }

  .hero-grid {
    grid-template-columns: 1fr;
  }

  .hero-copy {
    max-width: none;
    padding-top: 1.5rem;
  }

  .hero-visual {
    min-height: 26rem;
    order: -1;
  }

  .hero-stats {
    position: relative;
    transform: none;
    margin-top: 1.5rem;
  }

  .content {
    padding-top: 3rem;
  }

  .stat-strip {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .stat:nth-child(3)::before {
    display: none;
  }
}

@media (max-width: 640px) {
  .shell {
    width: min(100% - 1rem, 1120px);
  }

  .hero {
    padding-bottom: 2rem;
  }

  .hero h1 {
    font-size: clamp(2.55rem, 14vw, 4.6rem);
  }

  .hero p {
    max-width: 18rem;
  }

  .hero-visual {
    min-height: 21rem;
  }

  .giraffe-seal {
    width: min(18rem, 84%);
  }

  .stat-strip {
    grid-template-columns: 1fr;
  }

  .stat + .stat::before {
    left: 10%;
    right: 10%;
    top: 0;
    bottom: auto;
    width: auto;
    height: 1px;
  }

  .copy-line,
  .field-row {
    grid-template-columns: 1fr;
    gap: 0.45rem;
  }

  .field-row strong {
    white-space: normal;
  }

  .copy-line button,
  .field-row button {
    width: fit-content;
  }

  .steps li {
    grid-template-columns: 1fr;
    gap: 0.8rem;
  }
}
</style>
</head>
<body>
<main>
  <section class="hero">
    <div class="shell">
      <div class="hero-grid">
        <div class="hero-copy">
          <h1>🦒 법망 API</h1>
          <p>프롬프트 한 줄로 법률AI 에이전트 흉내내기</p>
        </div>
        <div class="hero-visual" aria-hidden="true">
          <div class="orbital"></div>
          <div class="giraffe-seal">
            <div class="seal-mark">🦒</div>
          </div>
        </div>
      </div>
      <div class="hero-stats">
        <div class="stat-strip">
          <div class="stat">
            <strong>1,707</strong>
            <span>법률</span>
          </div>
          <div class="stat">
            <strong>499,310</strong>
            <span>조문</span>
          </div>
          <div class="stat">
            <strong>171,257</strong>
            <span>판례</span>
          </div>
          <div class="stat">
            <strong>61,755</strong>
            <span>인용관계</span>
          </div>
        </div>
      </div>
    </div>
  </section>

  <section class="content">
    <div class="shell">
      <div class="document">
        <div class="usage-header">
          <h2>사용하기</h2>
        </div>

        <div class="usage-flow">
          <section class="channel">
            <div class="channel-head">
              <h3>Claude</h3>
            </div>
            <div class="copy-line">
              <code>https://api.beopmang.org</code>
              <button onclick="cc(this,'https://api.beopmang.org')">copy</button>
            </div>
            <p>대화에 붙여넣으면 알아서 호출합니다.</p>
          </section>

          <section class="channel">
            <div class="channel-head">
              <h3>ChatGPT (Plus 이상)</h3>
            </div>
            <ol class="steps">
              <li>
                <div class="step-no">①</div>
                <div class="step-body">
                  <p>설정 → 앱 → 고급 설정 → 개발자 모드 켜기</p>
                </div>
              </li>
              <li>
                <div class="step-no">②</div>
                <div class="step-body">
                  <p>앱 만들기 클릭</p>
                </div>
              </li>
              <li>
                <div class="step-no">③</div>
                <div class="step-body">
                  <p>아래 값 입력:</p>
                  <div class="field-grid">
                    <div class="field-row">
                      <strong>이름</strong>
                      <code>법망</code>
                      <button onclick="cc(this,'법망')">copy</button>
                    </div>
                    <div class="field-row">
                      <strong>URL</strong>
                      <code>https://api.beopmang.org/mcp</code>
                      <button onclick="cc(this,'https://api.beopmang.org/mcp')">copy</button>
                    </div>
                    <div class="field-row">
                      <strong>설명</strong>
                      <code>반드시 여러 번 호출하고 조문번호와 법령명을 구체적으로 인용하여 답하세요</code>
                      <button onclick="cc(this,'반드시 여러 번 호출하고 조문번호와 법령명을 구체적으로 인용하여 답하세요')">copy</button>
                    </div>
                    <div class="static-line">
                      <strong>인증:</strong>
                      <span>없음</span>
                    </div>
                  </div>
                </div>
              </li>
              <li>
                <div class="step-no">④</div>
                <div class="step-body">
                  <p>채팅에서 + → 더 보기 → 법망 선택</p>
                  <p>추천 모델: GPT 5.4 Thinking 이상</p>
                </div>
              </li>
            </ol>
          </section>

          <section class="channel">
            <div class="channel-head">
              <h3>Gemini</h3>
            </div>
            <p>환각이 심하여 권장하지 않습니다.</p>
            <p>사용 불가</p>
          </section>
        </div>
      </div>
    </div>
  </section>

  <footer class="footer">
    <div class="shell">
      <div class="footer-block">
        <p class="footer-nav"><a href="/openapi.json">OpenAPI</a> · <a href="/.well-known/agent.json">Agent Card</a> · <a href="/privacy">Privacy</a> · <a href="/health">Health</a></p>
        <p>데이터 출처: 법제처 Open API · 국회 Open API. 매주 일요일 갱신. 참고용이며 법적 효력 없음.</p>
      </div>
    </div>
  </footer>
</main>
<script>function cc(el,v){navigator.clipboard.writeText(v).then(function(){el.textContent='copied!';setTimeout(function(){el.textContent='copy'},1500)})}</script>
</body>
</html>
`;
  return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders(), ...rlHeaders } });
}

// ──────────────────────────────────────
// MCP Server (JSON-RPC 2.0 / Streamable HTTP)
// ──────────────────────────────────────

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
- sendFeedback: 피드백. params: {message, type?: "bug|feature|quality"}

unit_level: JO=조, HANG=항, HO=호, MOK=목
law_id는 6자리 숫자 (예: 001706=민법, 001692=형법)`,
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
    const availableCommands = TOOL_COMMANDS.join(', ');
    if (!command) return mcpErr(id, -32602, 'Missing command. Available: ' + availableCommands);
    if (!TOOL_COMMANDS.includes(command)) return mcpErr(id, -32602, 'Unknown command: ' + command + '. Available: ' + availableCommands);

    // Handle sendFeedback locally
    if (command === 'sendFeedback') {
      const msg = (p.message || '').slice(0, 1000);
      if (!msg) return mcpOk(id, { content: [{ type: 'text', text: 'Error: message required' }], isError: true });
      const entry = { message: msg, type: p.type || 'general', context: p.context || '', ts: new Date().toISOString() };
      await env.API_KV.put('fb:' + Date.now() + ':' + Math.random().toString(36).slice(2, 6), JSON.stringify(entry), { expirationTtl: 86400 * 90 });
      return mcpOk(id, { content: [{ type: 'text', text: 'Feedback received. Thank you.' }] });
    }

    try {
      const originUrl = buildOriginUrl(env.ORIGIN_BASE, command, p);
      if (!originUrl) {
        const errMsg = command === 'getArticle'
          ? {error:{code:'INVALID_ARGUMENT',message:'getArticle requires law_id and (article_label or article_path)',example:{law_id:'001706',article_label:'제750조'}}}
          : {error:{code:'INVALID_ARGUMENT',message:'Missing required parameters for ' + command}};
        return mcpOk(id, { content: [{ type: 'text', text: JSON.stringify(errMsg) }], isError: true });
      }
      const originData = await fetchOriginNormalized(originUrl, 'beopmang-mcp/1.0', command);
      if (!originData.ok) {
        return mcpOk(id, { content: [{ type: 'text', text: JSON.stringify(originData.errorPayload) }], isError: true });
      }

      let mainPayload = originData.result;
      // Handle include parameter
      if (p.include) {
        const lawId = mainPayload?.law_id || (Array.isArray(mainPayload) && mainPayload[0]?.law_id) || null;
        if (lawId) {
          const fields = p.include.split(',').map(s => s.trim()).filter(f => INCLUDE_COMMAND_MAP[f]);
          const inc = {};
          for (const f of fields) {
            const includeCommand = INCLUDE_COMMAND_MAP[f];
            const includeParams = f === 'bills' ? { query: mainPayload?.law_name || lawId } : { law_id: lawId };
            try {
              const includeUrl = buildOriginUrl(env.ORIGIN_BASE, includeCommand, includeParams);
              const includeData = await fetchOriginNormalized(includeUrl, 'beopmang-mcp/1.0', includeCommand);
              if (includeData.ok) inc[f] = includeData.result;
            } catch {}
          }
          mainPayload = { main: mainPayload, included: inc };
        }
      }
      return mcpOk(id, { content: [{ type: 'text', text: JSON.stringify(mainPayload, null, 2) }] });
    } catch (e) {
      return mcpOk(id, { content: [{ type: 'text', text: 'Error: ' + e.message }], isError: true });
    }
  }

  return mcpErr(id, -32601, 'Method not found: ' + method);
}
