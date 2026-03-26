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
  const buildDate = new Date().toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).replace(/\./g, '. ').replace(',', '.');
  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>법망 API</title>
<meta name="description" content="프롬프트 한 줄로 법률AI 에이전트 흉내내기">
<meta property="og:title" content="법망 API">
<meta property="og:description" content="프롬프트 한 줄로 법률AI 에이전트 흉내내기">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🦒</text></svg>">
<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.css">
<style>
:root {
  --bg: #f2ead3;
  --bg-soft: #ede4cb;
  --surface: #f7ecd2;
  --border: #c2a676;
  --border-soft: rgba(194,166,118,0.25);
  --ink: #3b2f20;
  --ink-soft: #4f3f2b;
  --muted: #897457;
  --accent: #9b7c4d;
  --accent-soft: rgba(194,166,118,0.15);
  --green: #2f6b4e;
  --shadow: 0 12px 24px rgba(59,47,32,0.08);
  --motion-fast: 0.15s;
  --ease: cubic-bezier(0.2,0,0,1);
}
* { box-sizing: border-box; }
body {
  margin: 0; min-height: 100vh;
  font-family: "Pretendard Variable","Pretendard",system-ui,sans-serif;
  background: var(--bg); color: var(--ink); line-height: 1.5;
  -webkit-tap-highlight-color: transparent;
}
.page { display: flex; justify-content: center; padding: 16px 12px 28px; }
.shell {
  max-width: 560px; width: 100%;
  padding-top: 24px; padding-bottom: 32px;
  animation: fadeUp 0.5s ease both;
}
@keyframes fadeUp {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}
.card {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 20px; box-shadow: var(--shadow); overflow: hidden;
}
.card-header { padding: 24px 24px 20px; border-bottom: 1px solid var(--border-soft); }
.card-header h1 { margin: 0; font-size: 1.15rem; font-weight: 600; letter-spacing: -0.01em; }
.card-desc { margin: 6px 0 0; font-size: 0.88rem; color: var(--ink-soft); }
.card-body { padding: 24px; display: flex; flex-direction: column; gap: 20px; }

.status-bar { display: flex; align-items: center; gap: 8px; font-size: 0.82rem; color: var(--muted); }
.dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--green); }
.status-bar strong { color: var(--ink); margin-left: auto; }

.stats { display: flex; gap: 24px; justify-content: center; flex-wrap: wrap; }
.stat { text-align: center; }
.stat-value { font-size: 1.25rem; font-weight: 700; letter-spacing: -0.02em; }
.stat-label { font-size: 0.72rem; color: var(--muted); margin-top: 2px; }

.divider { border: none; border-top: 1px solid var(--border-soft); margin: 0; }

.section { display: flex; flex-direction: column; gap: 6px; }
.section-title { margin: 0; font-size: 0.85rem; font-weight: 600; }
.section-title small { font-weight: 400; color: var(--muted); }
.section-desc { margin: 0; font-size: 0.82rem; color: var(--ink-soft); line-height: 1.5; }

.copy-row {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 12px; border-radius: 10px;
  border: 1px solid var(--border-soft); background: var(--bg);
}
.copy-row code { flex: 1; font-size: 0.82rem; font-family: ui-monospace,monospace; }
.copy-btn {
  padding: 4px 10px; border: 1px solid var(--border-soft); border-radius: 6px;
  background: none; font-size: 0.72rem; font-weight: 600; color: var(--muted);
  cursor: pointer; transition: background var(--motion-fast), color var(--motion-fast);
  font-family: inherit;
}
.copy-btn:hover { background: var(--accent-soft); color: var(--ink); }

.field-grid {
  display: grid; grid-template-columns: 2.5rem 1fr auto;
  gap: 6px 8px; align-items: center; font-size: 0.82rem;
}
.field-grid span { color: var(--muted); }
.field-grid code {
  font-family: ui-monospace,monospace; font-size: 0.78rem;
  padding: 6px 10px; background: var(--bg); border: 1px solid var(--border-soft);
  border-radius: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.steps { margin: 4px 0; padding-left: 1.2rem; }
.steps li { font-size: 0.82rem; color: var(--ink-soft); margin-bottom: 2px; }
.muted-note { font-size: 0.78rem; color: var(--muted); margin: 0; }

.card-footer {
  padding: 20px 24px; border-top: 1px solid var(--border-soft);
  font-size: 0.72rem; color: var(--muted);
}
.card-footer a { color: var(--accent); text-decoration: none; }
.card-footer a:hover { text-decoration: underline; }
.card-footer p { margin: 0; }
.card-footer p + p { margin-top: 6px; opacity: 0.7; }
.footer-update { margin-top: 8px; opacity: 0.5; font-size: 0.68rem; }

@media (max-width: 640px) {
  .page { padding: 10px 8px 20px; }
  .shell { padding-top: 12px; padding-bottom: 20px; }
  .card { border-radius: 16px; }
  .card-header { padding: 20px 18px 16px; }
  .card-body { padding: 18px; gap: 16px; }
  .card-footer { padding: 16px 18px; }
  .stats { gap: 16px; }
  .stat-value { font-size: 1.1rem; }
  .field-grid { grid-template-columns: 2.2rem 1fr auto; }
}
</style>
</head>
<body class="page">
<main class="shell">
<div class="card">

<div class="card-header">
<h1>🦒 법망 API</h1>
<p class="card-desc">프롬프트 한 줄로 법률AI 에이전트 흉내내기</p>
</div>

<div class="card-body">

<div class="status-bar" id="hc">
<span class="dot"></span>
<span>확인 중...</span>
<strong>—</strong>
</div>

<div class="stats">
<div class="stat"><div class="stat-value">1,707</div><div class="stat-label">법률</div></div>
<div class="stat"><div class="stat-value">499,310</div><div class="stat-label">조문</div></div>
<div class="stat"><div class="stat-value">171,257</div><div class="stat-label">판례</div></div>
<div class="stat"><div class="stat-value">61,755</div><div class="stat-label">인용관계</div></div>
</div>

<hr class="divider">

<div class="section">
<p class="section-title">Claude / Codex</p>
<div class="copy-row">
<code>https://api.beopmang.org</code>
<button class="copy-btn" onclick="cc(this,'https://api.beopmang.org')">복사</button>
</div>
<p class="section-desc">대화에 붙여넣으면 알아서 호출합니다.</p>
</div>

<div class="section">
<p class="section-title">ChatGPT <small>Plus 이상</small></p>
<ol class="steps">
<li>설정 → 앱 → 고급 설정 → 개발자 모드 켜기</li>
<li>앱 만들기 클릭</li>
<li>아래 값 입력:</li>
</ol>
<div class="field-grid">
<span>이름</span><code>법망</code><button class="copy-btn" onclick="cc(this,'법망')">복사</button>
<span>URL</span><code>https://api.beopmang.org/mcp</code><button class="copy-btn" onclick="cc(this,'https://api.beopmang.org/mcp')">복사</button>
<span>설명</span><code>반드시 여러 번 호출하고 조문번호와 법령명을 구체적으로 인용하여 답하세요</code><button class="copy-btn" onclick="cc(this,'반드시 여러 번 호출하고 조문번호와 법령명을 구체적으로 인용하여 답하세요')">복사</button>
<span>인증</span><code>없음</code><span></span>
</div>
<ol class="steps" start="4">
<li>채팅에서 + → 더 보기 → 법망 선택</li>
</ol>
<p class="muted-note">추천 모델: GPT 5.4 Thinking 이상</p>
</div>

<div class="section">
<p class="section-title">Gemini</p>
<p class="section-desc">환각이 심하여 권장하지 않습니다. 사용 불가.</p>
</div>

</div>

<div class="card-footer">
<p><a href="/openapi.json">OpenAPI</a> · <a href="/.well-known/agent.json">Agent Card</a> · <a href="/privacy">Privacy</a> · <a href="/health">Health</a></p>
<p>데이터 출처: 법제처 Open API · 국회 Open API. 참고용이며 법적 효력 없음.</p>
<p class="footer-update">최근 업데이트: ${buildDate}</p>
</div>

</div>
</main>
<script>
function cc(el,v){navigator.clipboard.writeText(v).then(function(){el.textContent='copied!';setTimeout(function(){el.textContent='복사'},1500)})}
fetch('/health').then(function(r){return r.json()}).then(function(d){
var el=document.getElementById('hc');
if(d.status==='ok')el.innerHTML='<span class="dot" style="background:#2f6b4e"></span><span>서버 정상</span><strong>'+d.origin_ms+'ms</strong>';
else el.innerHTML='<span class="dot" style="background:#dc2626"></span><span>오프라인</span><strong>점검 중</strong>';
}).catch(function(){document.getElementById('hc').innerHTML='<span class="dot" style="background:#d97706"></span><span>확인 불가</span><strong>—</strong>'});
</script>
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
