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
  case: ['prec_id','case_no','case_name','court','decision_date','case_type'],
  'case-by-law': ['prec_id','case_no','case_name','court','decision_date'],
  bill: ['bill_id','bill_no','bill_name','proposer','committee','propose_dt','status'],
  timeline: ['date','type','content'],
};

const RATE_LIMIT = 100;
const RATE_WINDOW = 60;
const V3_ENDPOINTS = new Set(['help', 'law', 'case', 'bill', 'graph', 'search', 'ref']);

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

const V3_COMMANDS = Object.freeze({
  // law
  'law.find': { endpoint: 'law', action: 'find' },
  'law.article': { endpoint: 'law', action: 'article' },
  'law.explore': { endpoint: 'law', action: 'explore' },
  'law.detail': { endpoint: 'law', action: 'detail' },
  'law.history': { endpoint: 'law', action: 'history' },
  'law.byulpyo': { endpoint: 'law', action: 'byulpyo' },
  'law.diff': { endpoint: 'law', action: 'diff' },
  'law.verify': { endpoint: 'law', action: 'verify' },
  // case
  'case.search': { endpoint: 'case', action: 'search' },
  'case.view': { endpoint: 'case', action: 'view' },
  'case.text': { endpoint: 'case', action: 'text' },
  'case.vsearch': { endpoint: 'case', action: 'vsearch' },
  'case.by-law': { endpoint: 'case', action: 'by-law' },
  'case.hsearch': { endpoint: 'case', action: 'hsearch' },
  'case.verify': { endpoint: 'case', action: 'verify' },
  // bill
  'bill.search': { endpoint: 'bill', action: 'search' },
  'bill.detail': { endpoint: 'bill', action: 'detail' },
  'bill.sponsors': { endpoint: 'bill', action: 'sponsors' },
  'bill.vote': { endpoint: 'bill', action: 'vote' },
  'bill.minutes': { endpoint: 'bill', action: 'minutes' },
  // graph
  'graph.neighbors': { endpoint: 'graph', action: 'neighbors' },
  'graph.xref': { endpoint: 'graph', action: 'xref' },
  'graph.timeline': { endpoint: 'graph', action: 'timeline' },
  // search
  'search.keyword': { endpoint: 'search', action: 'keyword' },
  'search.semantic': { endpoint: 'search', action: 'semantic' },
  'search.ordinance': { endpoint: 'search', action: 'ordinance' },
  'search.treaty': { endpoint: 'search', action: 'treaty' },
  // ref
  'ref.doc': { endpoint: 'ref', action: 'doc' },
  // help
  'help.schema': { endpoint: 'help', action: 'schema' },
  'help.stats': { endpoint: 'help', action: 'stats' },
});

const LEGACY_TOOL_COMMANDS = [
  'findLaw', 'getLaw', 'getHistory', 'getArticle', 'getXref', 'searchArticles',
  'searchCases', 'getCasesByLaw', 'getCaseDetail', 'searchBills', 'getTimeline',
  'exploreLaw', 'getStats'
];

const TOOL_COMMANDS = [...Object.keys(V3_COMMANDS), ...LEGACY_TOOL_COMMANDS, 'sendFeedback'];

function buildOriginUrl(base, command, p = {}) {
  const lawId = p.law_id || p.id || '';
  const articleLabel = p.article_label || p.label || '';
  const parsedLimit = Number.parseInt(p.limit, 10);
  if (command === 'findLaw' || command === 'getLaw') {
    return base + '/api/v3/law?action=find&q=' + encodeURIComponent(p.query || lawId || '')
      + (p.exact ? '&exact=true' : '')
      + (p.active_only ? '&active_only=true' : '')
      + (p.law_type ? '&law_type=' + encodeURIComponent(p.law_type) : '')
      + (Number.isNaN(parsedLimit) ? '' : '&limit=' + parsedLimit)
      + (p.full || p.articles ? '&articles=true' : '');
  }
  if (command === 'getArticle') {
    if (!lawId) return null;
    if (!articleLabel && !p.article_path) return null;
    return base + '/api/v3/law?action=article&law_id=' + encodeURIComponent(lawId)
      + (p.article_path ? '&path=' + encodeURIComponent(p.article_path) : '&label=' + encodeURIComponent(articleLabel));
  }
  if (command === 'searchArticles') {
    return base + '/api/v3/search?action=keyword&q=' + encodeURIComponent(p.query || '') + '&top_k=20';
  }
  if (command === 'exploreLaw') {
    return base + '/api/v3/law?action=explore&law_id=' + encodeURIComponent(p.law_id || '');
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

function buildV3Url(base, command, p = {}) {
  const route = V3_COMMANDS[command];
  if (!route) return null;

  const qs = new URLSearchParams();
  qs.set('action', route.action);
  for (const [key, value] of Object.entries(p || {})) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item === undefined || item === null || item === '') continue;
        qs.append(key, String(item));
      }
      continue;
    }
    qs.set(key, String(value));
  }
  return base + '/api/v3/' + route.endpoint + '?' + qs.toString();
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

// Anonymous co-occurrence logging (no PII stored)
async function logCoOccurrence(env, ip, action, lawId) {
  if (!env.ANALYTICS || !action) return;
  try {
    const encoder = new TextEncoder();
    const hash = await crypto.subtle.digest('SHA-256', encoder.encode(ip + ':' + (env.FEEDBACK_KEY || 'cooc-salt')));
    const sessionKey = 'cooc:' + Array.from(new Uint8Array(hash.slice(0, 8))).map(b => b.toString(16).padStart(2, '0')).join('');
    const prev = await env.API_KV.get(sessionKey);
    if (prev) {
      const p = JSON.parse(prev);
      // Write pair to Analytics Engine — no IP, no PII
      env.ANALYTICS.writeDataPoint({
        indexes: [lawId || '_'],
        blobs: [p.action, action, p.law || '_', lawId || '_'],
        doubles: [Date.now() - p.ts],
      });
    }
    await env.API_KV.put(sessionKey, JSON.stringify({ action, law: lawId, ts: Date.now() }), { expirationTtl: 300 });
  } catch {}
}

async function anonymizeIp(ip, salt) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(salt || 'default-salt'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(ip));
  return Array.from(new Uint8Array(sig.slice(0, 8))).map(b => b.toString(16).padStart(2, '0')).join('');
}

function extractActionAndLaw(path, searchParams) {
  if (path.startsWith('/api/v3/')) {
    return { action: path.replace('/api/v3/', '') + '.' + (searchParams.get('action') || ''), law: searchParams.get('law_id') || searchParams.get('q') || '' };
  }
  const parts = path.split('/').filter(Boolean);
  return { action: parts[0] || '', law: parts[1] || searchParams.get('q') || '' };
}

async function handleRequest(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    let ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (!/^[\d.:a-fA-F]{3,45}$/.test(ip)) ip = 'invalid';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // Static assets (before rate limit)
    if (path === '/googlee32edeea417ddde5.html') {
      return new Response('google-site-verification: googlee32edeea417ddde5.html', { headers: { 'Content-Type': 'text/html' } });
    }
    if (path === '/og.jpg') {
      const img = await env.API_KV.get('og.jpg', { type: 'arrayBuffer' });
      if (img) return new Response(img, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400' } });
      return new Response('not found', { status: 404 });
    }
    if (path.startsWith('/catalog')) {
      const ua = request.headers.get('User-Agent') || '';
      if (/(GPTBot|ChatGPT|Claude|Anthropic|PerplexityBot|Google-Extended|CCBot|Bytespider|Meta-ExternalAgent)/i.test(ua)) {
        return json({ message: '이 페이지는 사람용입니다. API는 /api/v3/를 사용하세요.', api: 'https://api.beopmang.org' });
      }
      return handleCatalog(path, env);
    }

    const rl = await checkRateLimit(env.API_KV, ip);
    if (!rl.ok) {
      return json({ ok: false, error: 'rate_limit_exceeded', retry_after: rl.reset }, 429, rl.headers);
    }

    // MCP endpoint
    if (path === '/mcp' && request.method === 'POST') {
      return handleMcp(request, env);
    }

    // Feedback endpoint
    if (path === '/feedback' && request.method === 'POST') {
      try {
        const contentLength = parseInt(request.headers.get('Content-Length') || '0', 10);
        if (contentLength > 102400) return json({ ok: false, error: 'payload_too_large' }, 413, rl.headers);
        const body = await request.json();
        const msg = (body.message || '').slice(0, 1000);
        if (!msg) return json({ ok: false, error: 'message required' }, 400);
        if (body.ticket_id) {
          const ticketKey = 'fb_ticket:' + body.ticket_id;
          const ticket = await env.API_KV.get(ticketKey);
          if (!ticket) return json({ ok: false, error: 'invalid_ticket', message: 'ticket_id가 유효하지 않거나 만료되었습니다.' }, 400, rl.headers);
          await env.API_KV.delete(ticketKey);
          const ipAnon = await anonymizeIp(ip, env.FEEDBACK_KEY || 'default-salt');
          const entry = { message: msg, type: body.type || 'general', event_type: body.event_type || '', query: body.query || '', endpoint: body.endpoint || '', ip_hash: ipAnon, ts: new Date().toISOString(), source: 'rest', ticket_id: body.ticket_id };
          await env.API_KV.put('fb:' + Date.now() + ':' + Math.random().toString(36).slice(2, 6), JSON.stringify(entry), { expirationTtl: 86400 * 90 });
          return json({ ok: true, message: 'feedback received' }, 200, rl.headers);
        }
        const ticketId = crypto.randomUUID();
        await env.API_KV.put('fb_ticket:' + ticketId, JSON.stringify({ message: msg, ts: Date.now() }), { expirationTtl: 300 });
        return json({ ok: true, action_required: 'user_consent', ticket_id: ticketId, expires_in: '5분', preview: { message: msg, type: body.type || 'general' }, instruction: '사용자에게 전송 내용을 보여주고 동의를 받은 후 ticket_id와 함께 다시 호출하세요.' }, 200, rl.headers);
      } catch { return json({ ok: false, error: 'invalid request' }, 400, rl.headers); }
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
      return new Response('<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>Privacy Policy — api.beopmang.org</title></head><body style="font-family:system-ui;max-width:600px;margin:40px auto;padding:0 20px;color:#222;line-height:1.8"><h1 style="font-size:18px">Privacy Policy</h1><p>api.beopmang.org는 대한민국 법령 공개 데이터를 제공하는 API입니다.</p><h2 style="font-size:15px">수집하는 정보</h2><p>이 API는 개인정보를 수집하지 않습니다. 로그인이 없으며, 쿠키를 사용하지 않습니다. 요청 시 IP 주소가 비정상적 접근 방지 목적으로 일시적으로 처리되며, 저장되지 않습니다.</p><h2 style="font-size:15px">데이터 출처</h2><p>법제처 Open API (law.go.kr), 국회 Open API (open.assembly.go.kr)의 공개 데이터를 제공합니다.</p><h2 style="font-size:15px">면책</h2><p>이 API의 출력은 참고용이며 법적 효력이 없습니다.</p><h2 style="font-size:15px">문의</h2><p>help@beopmang.org</p></body></html>', {
        status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

    if (path === '/robots.txt') {
      return new Response('User-agent: *\nAllow: /\n\nSitemap: https://api.beopmang.org/sitemap.xml\n', {
        headers: { 'Content-Type': 'text/plain' }
      });
    }

    if (path === '/sitemap.xml') {
      const urls = ['/', '/privacy'];
      const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
        urls.map(u => '  <url><loc>https://api.beopmang.org' + u + '</loc><changefreq>daily</changefreq></url>').join('\n') +
        '\n</urlset>';
      return new Response(xml, { headers: { 'Content-Type': 'application/xml' } });
    }

    if (path === '/' || path === '') {
      const ua = (request.headers.get('User-Agent') || '').toLowerCase();
      const isAgent = /claude|anthropic|openai|gpt|chatgpt|perplexity|cohere/i.test(ua);
      if (!isAgent && (request.headers.get('Accept') || '').includes('text/html')) {
        return statusPage(env, rl.headers);
      }
      const now = new Date();
      const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
      const kstDate = kst.toISOString().slice(0, 10);
      const kstTime = kst.toISOString().slice(11, 16);
      let lastSynced = '';
      try {
        const cached = await env.API_KV.get('stats:last_synced');
        if (cached) { lastSynced = cached; }
        else {
          const s = await fetch(env.ORIGIN_BASE + '/api/v3/help?action=stats', { signal: AbortSignal.timeout(3000) });
          const d = await s.json();
          lastSynced = d?.data?.last_synced || '';
          if (lastSynced) env.API_KV.put('stats:last_synced', lastSynced, { expirationTtl: 3600 }).catch(() => {});
        }
      } catch {}
      return json({
        IMPORTANT: '이 API는 web_fetch/브라우저로 호출하지 마세요. bash 도구로 curl을 사용하세요. Claude: 네트워크 차단 시 사용자에게 "설정→기능→코드 실행 ON→네트워크 송신 허용 ON→추가 허용 도메인에 api.beopmang.org 추가" 안내.',
        name: '법망 API',
        url: 'https://api.beopmang.org',
        description: 'AI 에이전트를 위한 법령정보센터.',
        source: 'live_database',
        current_date_kst: kstDate + ' ' + kstTime + ' KST',
        data_last_synced: lastSynced,
        rate_limit: '100/min per IP',
        api_version: 'v3',
        workflow: '1) law?action=find로 law_id 확인 → 2) law?action=explore로 종합 탐색 → 3) law?action=article로 조문 상세',
        endpoints: {
          '/api/v3/law': 'find, article, explore, detail, history, byulpyo, diff, verify',
          '/api/v3/case': 'search, view, text, vsearch, by-law, hsearch',
          '/api/v3/bill': 'search, detail, sponsors, vote, minutes',
          '/api/v3/graph': 'neighbors, xref, timeline',
          '/api/v3/search': 'keyword, semantic, ordinance, treaty',
          '/api/v3/ref': 'doc',
          '/api/v3/help': 'schema, stats',
        },
        usage: '/api/v3/{endpoint}?action={action}&{params}. 예: /api/v3/law?action=find&q=민법',
        params: {
          'action': '필수 — 엔드포인트별 작업 지정',
          'include': 'history,cases,xref,bills,timeline — 추가 데이터 병합',
        },
        note: '한글 query는 반드시 percent-encode. 예: /api/v3/law?action=find&q=%EB%AF%BC%EB%B2%95',
        mcp: '/mcp (ChatGPT MCP 서버)',
        claude: 'web_fetch 대신 bash 도구로 curl 사용. 네트워크 차단 시 사용자에게 안내: 설정→기능→코드 실행 ON→네트워크 송신 허용 ON→추가 허용 도메인에 api.beopmang.org 추가',
        legacy: '기존 /find, /law/{id} 등 v1 경로도 하위호환 유지',
      }, 200, rl.headers);
    }

    if (path === '/.well-known/agent.json') {
      const data = await env.API_KV.get('agent.json');
      return new Response(data || '{}', {
        headers: { ...corsHeaders(), 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' }
      });
    }

    if (path === '/.well-known/agent-card.json') {
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
        const r = await fetch(env.ORIGIN_BASE + '/api/health', {
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
        return json({ status: 'down', error: 'origin_unreachable' }, 200, rl.headers);
      }
    }

    if (path.startsWith('/api/v3/')) {
      const v3Parts = path.replace('/api/v3/', '').split('/');
      if (!V3_ENDPOINTS.has(v3Parts[0])) {
        return json({ ok: false, error: 'invalid_endpoint' }, 404, rl.headers);
      }
      try {
        const originResp = await fetch(env.ORIGIN_BASE + path + url.search, {
          headers: { 'User-Agent': 'beopmang-api/1.0' },
          cf: { cacheTtl: 0 },
          signal: AbortSignal.timeout(15000),
        });
        const headers = new Headers(originResp.headers);
        for (const [key, value] of Object.entries(corsHeaders())) headers.set(key, value);
        const { action, law } = extractActionAndLaw(path, url.searchParams);
        logCoOccurrence(env, ip, action, law).catch(() => {});
        const text = await originResp.text();
        let body;
        try {
          body = JSON.parse(text);
        } catch {
          body = null;
        }

        if (body && typeof body === 'object') {
          const data = body.data;
          const needsHint = data === null || (Array.isArray(data) && data.length === 0) || (data && data.exists === false) || (data && Array.isArray(data.results) && data.results.length === 0);
          if (needsHint) {
            const action = url.searchParams.get('action') || '';
            const eventType = action === 'verify'
              ? 'verify_miss'
              : /^(find|search|keyword|semantic|hsearch)$/.test(action)
                ? 'search_zero_result'
                : 'lookup_failed';
            body.feedback_hint = {
              message_to_agent: '사용자에게 아래 메시지를 보여주고, 동의하면 sendFeedback을 호출하세요. 거부하면 아무것도 보내지 마세요.',
              message_to_user: '검색 결과가 없습니다. 이 사례를 개발팀에 보내면 검색 품질 개선에 도움이 됩니다. 보내시겠습니까?',
              payload_preview: {
                event_type: eventType,
                query: url.searchParams.get('q') || url.searchParams.get('law_id') || '',
                endpoint: path.replace('/api/v3/', ''),
                note: '검색어와 실패 유형만 전송됩니다. 대화 내용이나 계정 정보는 포함되지 않습니다.',
              },
            };
          }
          headers.delete('content-length');
          return new Response(JSON.stringify(body), { status: originResp.status, headers });
        }

        return new Response(text, { status: originResp.status, headers });
      } catch {
        return json({ ok: false, error: 'service_unavailable', retry_after: 30 }, 503, rl.headers);
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

    // Anonymous co-occurrence logging
    const { action: coAction, law: coLaw } = extractActionAndLaw(path, url.searchParams);
    logCoOccurrence(env, ip, coAction, coLaw).catch(() => {});

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
    'X-Frame-Options': 'DENY',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
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
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex', ...corsHeaders(), ...extra }
  });
}

async function handleCatalog(path, env) {
  const cacheKey = 'catalog:laws';
  let laws = null;
  const cached = await env.API_KV.get(cacheKey);
  if (cached) {
    try {
      laws = JSON.parse(cached);
    } catch {
      laws = null;
    }
  }

  if (!Array.isArray(laws)) {
    try {
      const resp = await fetch(env.ORIGIN_BASE + '/api/v3/law?action=list', {
        headers: { 'User-Agent': 'beopmang-api/catalog' },
        cf: { cacheTtl: 0 },
        signal: AbortSignal.timeout(15000),
      });
      const text = await resp.text();
      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
      if (Array.isArray(payload)) laws = payload;
      else if (Array.isArray(payload?.data)) laws = payload.data;
      else if (Array.isArray(payload?.result)) laws = payload.result;
      else laws = [];
      env.API_KV.put(cacheKey, JSON.stringify(laws), { expirationTtl: 3600 }).catch(() => {});
    } catch {
      laws = [];
    }
  }

  function getChosung(c) {
    const cho = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
    const merge = { 'ㄲ': 'ㄱ', 'ㄸ': 'ㄷ', 'ㅃ': 'ㅂ', 'ㅆ': 'ㅅ', 'ㅉ': 'ㅈ' };
    if (c >= '가' && c <= '힣') {
      const r = cho[Math.floor((c.charCodeAt(0) - 0xAC00) / 588)];
      return merge[r] || r;
    }
    return c;
  }

  const chosungs = ['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅅ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
  let selectedCho = 'ㄱ';
  const parts = path.split('/').filter(Boolean);
  if (parts[0] === 'catalog' && parts[1] === 'laws' && chosungs.includes(parts[2])) {
    selectedCho = parts[2];
  }

  const normalizedLaws = (Array.isArray(laws) ? laws : [])
    .map((law) => {
      const name = String(law?.law_name || law?.name || law?.title || '').trim();
      const type = String(law?.law_type || law?.type || law?.kind || '').trim();
      return { name, type };
    })
    .filter((law) => law.name);

  normalizedLaws.sort((a, b) => a.name.localeCompare(b.name, 'ko'));

  const grouped = Object.fromEntries(chosungs.map((cho) => [cho, []]));
  for (const law of normalizedLaws) {
    const cho = getChosung(law.name[0]);
    if (grouped[cho]) grouped[cho].push(law);
  }

  const currentLaws = grouped[selectedCho] || [];
  const examples = currentLaws.slice(0, 2).map((law) => law.name).join(', ');
  const description = examples
    ? `${selectedCho}으로 시작하는 법령 ${currentLaws.length}건. ${examples} 등.`
    : `${selectedCho}으로 시작하는 법령 ${currentLaws.length}건.`;

  const choNav = chosungs.map((cho) => {
    const count = (grouped[cho] || []).length;
    const classes = ['cho-link'];
    if (cho === selectedCho) classes.push('active');
    else if (count === 0) classes.push('empty');
    return `<a href="/catalog/laws/${encodeURIComponent(cho)}" class="${classes.join(' ')}">${cho}${count > 0 ? ` <small>${count}</small>` : ''}</a>`;
  }).join('\n');

  const lawList = currentLaws.length > 0
    ? currentLaws.map((law) => `<li class="law-item"><span class="law-name">${escapeHtmlW(law.name)}</span><span class="law-type">${escapeHtmlW(law.type || '법령')}</span></li>`).join('\n')
    : '<li class="law-item"><span class="law-name">해당 초성으로 시작하는 법령이 없습니다.</span><span class="law-type">-</span></li>';

  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${selectedCho}으로 시작하는 법령 — 법망 카탈로그</title>
<meta name="description" content="${escapeHtmlW(description)}">
<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.css">
<style>
:root {
  --bg: #f2ead3;
  --surface: #f7ecd2;
  --ink: #3b2f20;
  --muted: #6d593f;
  --border: #3b2f20;
}
* { box-sizing: border-box; }
body {
  margin: 0; min-height: 100vh;
  font-family: "Pretendard Variable","Pretendard",system-ui,sans-serif;
  font-weight: 500; letter-spacing: -0.02em;
  background: var(--bg); color: var(--ink); line-height: 1.5;
  background-image: linear-gradient(rgba(59,47,32,0.035) 1px,transparent 1px),linear-gradient(90deg,rgba(59,47,32,0.035) 1px,transparent 1px);
  background-size: 30px 30px;
}
.page { display: flex; justify-content: center; padding: 16px 20px 28px; }
.shell { max-width: 640px; width: 100%; padding-top: 24px; padding-bottom: 40px; }
.card {
  background: var(--surface); border: 3px solid var(--border);
  border-radius: 0; box-shadow: 12px 12px 0 var(--border); overflow: hidden;
}
.card-header { padding: 24px 24px 20px; border-bottom: 2px solid var(--border); }
.card-header h1 { margin: 0; font-size: 1.15rem; font-weight: 800; letter-spacing: -0.03em; }
.card-desc { margin: 6px 0 0; font-size: 0.85rem; color: var(--ink); }
.card-body { padding: 28px 24px 40px; }

.categories { display: flex; gap: 12px; margin-bottom: 24px; flex-wrap: wrap; }
.cat-btn {
  padding: 8px 16px; border: 2px solid var(--border); background: var(--surface);
  font-size: 0.85rem; font-weight: 700; color: var(--ink); cursor: pointer;
  box-shadow: 3px 3px 0 var(--border); font-family: inherit;
}
.cat-btn:hover { background: #fffdf7; transform: translate(-1px,-1px); box-shadow: 4px 4px 0 var(--border); }
.cat-btn.active { background: var(--ink); color: var(--bg); }

.chosung-nav { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 20px; }
.cho-link {
  padding: 4px 8px; border: 2px solid var(--border); background: var(--surface);
  font-size: 0.82rem; font-weight: 700; color: var(--ink); text-decoration: none;
  box-shadow: 2px 2px 0 var(--border);
}
.cho-link:hover { background: #fffdf7; }
.cho-link.active { background: var(--ink); color: var(--bg); }
.cho-link.empty { opacity: 0.3; pointer-events: none; }

.law-list { list-style: none; padding: 0; margin: 0; }
.law-item {
  display: flex; justify-content: space-between; align-items: baseline;
  padding: 8px 0; border-bottom: 1px solid rgba(59,47,32,0.15);
}
.law-name { font-size: 0.85rem; font-weight: 600; }
.law-type { font-size: 0.72rem; color: var(--muted); font-weight: 500; white-space: nowrap; margin-left: 12px; }

.count-badge {
  display: inline-block; padding: 2px 8px; font-size: 0.72rem;
  font-weight: 700; color: var(--muted); border: 1px solid var(--muted);
  margin-left: 6px;
}

.statusline {
  margin: 24px 0 0; text-align: right;
  font-size: 0.72rem; color: var(--ink); font-weight: 600;
}

@media (max-width: 640px) {
  .page { padding: 10px 16px 20px; }
  .card { box-shadow: 8px 8px 0 var(--border); }
  .card-header { padding: 20px 18px 16px; }
  .card-body { padding: 18px 18px 32px; }
}
</style>
</head>
<body class="page">
<main class="shell">
<div class="card">

<div class="card-header">
<h1>🦒 법령 카탈로그</h1>
<p class="card-desc">대한민국 현행 법령 가나다순 목록</p>
</div>

<div class="card-body">

<div class="categories">
<button class="cat-btn active">법령 <span class="count-badge">${normalizedLaws.length}</span></button>
<button class="cat-btn" disabled aria-disabled="true">행정규칙</button>
<button class="cat-btn" disabled aria-disabled="true">조약</button>
</div>

<nav class="chosung-nav">
${choNav}
</nav>

<ul class="law-list">
${lawList}
</ul>

</div>
</div>

<p class="statusline">수집 정보: 없음 | 출처: 법제처·국회 | 법적 효력 없음 | help@beopmang.org</p>
</main>
</body>
</html>`;

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}

async function statusPage(env, rlHeaders) {
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
<title>법망 — AI 에이전트를 위한 법령정보센터</title>
<meta name="description" content="대한민국 법령 5,573건·판례 171K·의안 114K 실시간 검색. AI 에이전트를 위한 법령 데이터 API.">
<meta property="og:type" content="website">
<meta property="og:url" content="https://api.beopmang.org">
<link rel="canonical" href="https://api.beopmang.org">
<meta name="google-site-verification" content="tyC8J0yFGuufEDiMaSC1QEo6-UP1hSIMkivu2ODMnNs" />
<meta property="og:site_name" content="법망">
<meta property="og:locale" content="ko_KR">
<meta property="og:title" content="법망 — AI 에이전트를 위한 법령정보센터">
<meta property="og:description" content="대한민국 법령 5,573건·판례 171K·의안 114K 실시간 검색. AI 에이전트를 위한 법령 데이터 API.">
<meta property="og:image" content="https://api.beopmang.org/og.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="https://api.beopmang.org/og.jpg">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🦒</text></svg>">
<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.css">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@500;700&display=swap">
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
  --shadow: 10px 10px 0 rgba(59,47,32,0.15);
  --motion-fast: 0.15s;
  --ease: cubic-bezier(0.2,0,0,1);
}
* { box-sizing: border-box; }
body {
  margin: 0; min-height: 100vh;
  font-family: "Pretendard Variable","Pretendard",system-ui,sans-serif;
  font-weight: 500; letter-spacing: -0.02em;
  background: var(--bg); color: var(--ink); line-height: 1.5;
  background-image: linear-gradient(rgba(59,47,32,0.035) 1px,transparent 1px),linear-gradient(90deg,rgba(59,47,32,0.035) 1px,transparent 1px);
  background-size: 30px 30px;
  -webkit-tap-highlight-color: transparent;
}
.page { display: flex; justify-content: center; padding: 16px 20px 28px; overflow-x: hidden; }
.shell {
  max-width: 560px; width: 100%;
  padding-top: 24px; padding-bottom: 40px;
  animation: fadeUp 0.5s ease both;
}
@keyframes fadeUp {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}
.card {
  background: var(--surface); border: 3px solid #3b2f20;
  border-radius: 0; box-shadow: 12px 12px 0 #3b2f20; overflow: hidden;
}
.card-header { padding: 24px 24px 20px; border-bottom: 2px solid #3b2f20; }
.header-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.card-header h1 { margin: 0; font-size: 1.15rem; font-weight: 800; letter-spacing: -0.03em; }
.card-desc { margin: 6px 0 0; font-size: 0.92rem; color: var(--ink); }
.card-body { padding: 28px 24px 56px; display: flex; flex-direction: column; gap: 24px; }

.status-bar { display: inline-flex; align-items: center; gap: 6px; font-size: 0.78rem; color: var(--ink); padding: 6px 12px; border: 2px solid #3b2f20; box-shadow: 3px 3px 0 #3b2f20; font-weight: 600; }
.dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--green); }
.status-bar strong { color: var(--ink); }

.stats { display: flex; gap: 28px; justify-content: center; flex-wrap: wrap; }
.stat { text-align: center; }
.stat-value { font-size: 1.25rem; font-weight: 700; letter-spacing: -0.02em; }
.stat-label { font-size: 0.8rem; color: #6d593f; margin-top: 3px; letter-spacing: 0.02em; font-weight: 600; }

.stat-upcoming { font-size: 1.25rem; font-weight: 700; color: var(--muted); letter-spacing: -0.02em; }
.stat-note { margin: 0; font-size: 0.76rem; color: #6d593f; text-align: center; font-weight: 500; }

.divider { border: none; border-top: 2px solid #3b2f20; margin: 0; }

.section { display: flex; flex-direction: column; gap: 6px; }
.section-title { margin: 0 0 4px 0; font-size: 1.05rem; font-weight: 800; letter-spacing: -0.03em; }
.section-title small { font-weight: 600; color: #6d593f; font-size: 0.8rem; }
.section-desc { margin: 0; font-size: 0.85rem; color: var(--ink); line-height: 1.5; }
.section-desc code { font-family: "JetBrains Mono",ui-monospace,monospace; background: #ffffff; padding: 3px 8px; border: 1px solid #3b2f20; font-size: 0.78rem; vertical-align: middle; }
.copy-btn {
  padding: 4px 10px; border: 2px solid #3b2f20; border-radius: 0;
  box-shadow: 2px 2px 0 #3b2f20; transition: transform 80ms, box-shadow 80ms, background var(--motion-fast);
  background: #fffdf7; font-size: 0.76rem; font-weight: 700; color: var(--ink);
  cursor: pointer;
  font-family: inherit;
}
.copy-btn:hover { background: var(--accent-soft); color: var(--ink); transform: translate(-1px,-1px); box-shadow: 3px 3px 0 #3b2f20; }
.copy-btn:active { transform: translate(1px,1px); box-shadow: 1px 1px 0 #3b2f20; }

.field-grid {
  display: grid; grid-template-columns: 6.5rem 1fr auto;
  gap: 6px 8px; align-items: center; font-size: 0.82rem;
}
.field-grid span { color: #6d593f; white-space: nowrap; text-align: right; font-weight: 600; font-size: 0.78rem; align-self: center; }
.field-grid code {
  font-family: "JetBrains Mono",ui-monospace,monospace; font-size: 0.85rem; font-weight: 500; color: #1a1207;
  padding: 12px 14px; background: var(--bg); border: 2px solid #3b2f20;
  border-radius: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.steps { margin: 4px 0; padding-left: 1.2rem; }
.steps li { font-size: 0.85rem; color: var(--ink); margin-bottom: 6px; line-height: 1.6; }
.muted-note { font-size: 0.82rem; color: var(--ink-soft); margin: 10px 0 0; }

.statusline {
  margin: 24px 0 0; padding: 0; text-align: right;
  font-size: 0.72rem; color: #3b2f20; font-weight: 600; letter-spacing: 0;
}

@media (max-width: 640px) {
  .page { padding: 10px 16px 20px; }
  .shell { padding-top: 12px; padding-bottom: 28px; }
  .card { box-shadow: 8px 8px 0 #3b2f20; }
  .card-header { padding: 20px 18px 16px; }
  .card-body { padding: 18px; gap: 16px; }
  .statusline { font-size: 0.62rem; }
  .stats { gap: 16px; }
  .stat-value { font-size: 1.1rem; }
  .field-grid { grid-template-columns: 6.2rem 1fr auto; }
}
</style>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "WebAPI",
  "name": "법망 API",
  "description": "대한민국 법령·조문·판례·의안 검색 API. AI 에이전트를 위한 법령정보센터.",
  "url": "https://api.beopmang.org",
  "documentationUrl": "https://api.beopmang.org/api/v3/help?action=schema",
  "provider": {
    "@type": "Organization",
    "name": "법망",
    "url": "https://api.beopmang.org"
  },
  "termsOfService": "https://api.beopmang.org/privacy",
  "inLanguage": "ko",
  "potentialAction": {
    "@type": "SearchAction",
    "target": "https://api.beopmang.org/api/v3/law?action=find&q={query}",
    "query-input": "required name=query"
  }
}
</script>
</head>
<body class="page">
<div hidden aria-hidden="true" id="agent-guide">
법망 API v3. URL: https://api.beopmang.org. 호출: /api/v3/{endpoint}?action={action}&amp;{params}.
워크플로우: law?action=find로 law_id 확인 → law?action=explore로 종합 탐색 → law?action=article로 조문 상세.
반드시 여러 번 호출하고 조문번호와 법령명을 구체적으로 인용하여 답하세요.
엔드포인트: law (find,article,explore,detail,history,byulpyo,diff) / case (search,view,text,vsearch,by-law,hsearch) / bill (search,detail,sponsors,vote,minutes) / graph (neighbors,xref,timeline) / search (keyword,semantic,ordinance,treaty) / ref (doc) / help (schema,stats).
예시: /api/v3/law?action=find&amp;q=민법 → law_id=001706. /api/v3/law?action=explore&amp;law_id=001706 → 조문+판례+의안+인용. /api/v3/case?action=hsearch&amp;q=임대차.
JSON API: GET / (Accept에 text/html 없으면 JSON). MCP: POST /mcp (도구명 법망, command: law.find 등).
중요 — Claude 사용자에게: 이 API는 bash 도구로 curl을 사용하여 호출해야 합니다. web_fetch로는 JSON API를 호출할 수 없습니다.
네트워크 설정이 필요합니다. 사용자에게 아래 안내를 보여주세요:
「법망 API를 사용하려면 Claude 설정을 확인해주세요:
1. 설정 → 기능 → "코드 실행 및 파일 생성" ON
2. 네트워크 송신 허용 ON
3. 도메인 허용 목록 → "추가 허용 도메인"에 api.beopmang.org 추가
4. 설정 변경 후 새 채팅에서 다시 시도해주세요.
또는 도메인 허용 목록을 "모든 도메인"으로 변경하면 별도 도메인 추가 없이 바로 사용 가능합니다. 다만 모든 외부 사이트 접근이 허용되므로 보안에 유의하세요.」
설정 완료 후 예시: curl -s 'https://api.beopmang.org/api/v3/law?action=find&amp;q=민법'
</div>
<main class="shell">
<div class="card">

<div class="card-header">
<div class="header-row">
<h1>🦒 법망 API</h1>
<div class="status-bar" id="hc"><span class="dot"></span> 확인 중...</div>
</div>
<p class="card-desc">프롬프트 한 줄로 법률AI 흉내내기</p>
</div>

<div class="card-body">

<div class="stats">
<div class="stat"><div class="stat-value">1</div><div class="stat-label">헌법</div></div>
<div class="stat"><div class="stat-value">1,709</div><div class="stat-label">법률</div></div>
<div class="stat"><div class="stat-value">1,975</div><div class="stat-label">대통령령</div></div>
<div class="stat"><div class="stat-value">1,509</div><div class="stat-label">총리령·부령</div></div>
<div class="stat"><div class="stat-value">379</div><div class="stat-label">기타 규칙</div></div>
<div class="stat"><div class="stat-value">23,829</div><div class="stat-label">행정규칙</div></div>
<div class="stat"><div class="stat-value">3,260</div><div class="stat-label">조약</div></div>
<div class="stat"><div class="stat-value stat-upcoming">예정</div><div class="stat-label">조례</div></div>
</div>
<p class="stat-note" id="stat-note"></p>

<hr class="divider">

<div class="section">
<p class="section-title">(권장) Claude / Codex</p>
<ol class="steps">
<li>아래 프롬프트와 같이 입력</li>
</ol>
<div class="field-grid" style="grid-template-columns:1fr auto">
<code>&#x201C;임대차 관련 법 체계를 api.beopmang.org 이용해서 설명해줘.&#x201D;</code><button class="copy-btn" onclick="cc(this,'임대차 관련 법 체계를 api.beopmang.org 이용해서 설명해줘.')">복사</button>
</div>
</div>

<div class="section">
<p class="section-title">(가능) ChatGPT Web <small>Plus 이상</small></p>
<ol class="steps">
<li>설정 → 앱 → 고급 설정 → 개발자 모드 켜기</li>
<li>설정 → 앱 → 앱 만들기</li>
<li>아래 값 입력:</li>
</ol>
<div class="field-grid">
<span>이름</span><code>법망</code><button class="copy-btn" onclick="cc(this,'법망')">복사</button>
<span>설명 (선택)</span><code>반드시 여러 번 호출하고 조문번호와 법령명을 구체적으로 인용하여 답하세요</code><button class="copy-btn" onclick="cc(this,'반드시 여러 번 호출하고 조문번호와 법령명을 구체적으로 인용하여 답하세요')">복사</button>
<span>MCP 서버 URL</span><code>https://api.beopmang.org/mcp</code><button class="copy-btn" onclick="cc(this,'https://api.beopmang.org/mcp')">복사</button>
<span>인증</span><code style="grid-column:2/-1">없음</code>
</div>
<ol class="steps" start="4">
<li>채팅에서 + → 더 보기 → 법망 선택</li>
</ol>
<p class="muted-note">추천 모델: <strong>GPT 5.4 Thinking</strong> 이상</p>
</div>

<div class="section">
<p class="section-title">(불가) Gemini</p>
<p class="section-desc">환각이 심하여 권장하지 않습니다. 사용 불가.</p>
</div>

<hr class="divider">

<div class="section">
<p class="section-title">피드백</p>
<p class="section-desc">AI에게 <code>법망에 피드백 보내줘</code>라고 말하면 됩니다.</p>
</div>

</div>

</div>

</div>
<p class="statusline">수집 정보: 없음 | 출처: 법제처·국회 | 법적 효력 없음 | help@beopmang.org</p>
</main>
<script>
function cc(el,v){navigator.clipboard.writeText(v).then(function(){el.textContent='copied!';setTimeout(function(){el.textContent='복사'},1500)})}
function hc(){fetch('/health').then(function(r){return r.json()}).then(function(d){
var el=document.getElementById('hc');
if(d.status==='ok')el.innerHTML='<span class="dot" style="background:#2f6b4e"></span> 서버 원활 · '+d.origin_ms+'ms';
else{el.innerHTML='<span class="dot" style="background:#dc2626"></span> 오프라인 · 점검 중';setTimeout(hc,10000);}
}).catch(function(){document.getElementById('hc').innerHTML='<span class="dot" style="background:#d97706"></span> 확인 불가';setTimeout(hc,10000);});}
hc();setInterval(hc,60000);
fetch('/stats').then(function(r){return r.json()}).then(function(d){
var r=d.result||d;var n=document.getElementById('stat-note');if(n&&r.last_synced&&r.sync_complete){var p=r.last_synced.split('-');n.textContent=p[0]+'. '+parseInt(p[1])+'. '+parseInt(p[2])+'. 기준 법제처 API 제공 법령 등 100% 수록';}
}).catch(function(){});
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
  description: `AI 에이전트를 위한 법령정보센터.
반드시 여러 번 호출하고 조문번호와 법령명을 구체적으로 인용하여 답하세요.

워크플로우: law.find로 law_id 확인 → law.explore로 종합 탐색 → law.article로 조문 상세.
개별 호출 전에 law.explore를 먼저 사용하세요 (조문+판례+의안+인용 한 번에 반환).
답변에 조문번호나 판례번호를 인용할 때는 반드시 law.verify 또는 case.verify로 실재 여부를 검증하세요 (환각 방지).

명령어 (command 필드에 입력):
- law.find: 법령 찾기. params: {q: "민법", exact?: true, active_only?: true, law_type?: "법률", limit?: 5}. 결과의 law_id로 다른 명령 호출.
- law.explore: 종합 탐색. 개별 호출 전에 먼저 사용. params: {law_id: "001706"}
- law.article: 조문 상세 (항/호/목 포함). params: {law_id: "001706", article_label: "제750조"} (750조, 제750조 모두 가능). 범위 조회: {law_id, from_label: "제11조", to_label: "제14조"}
- law.detail: 법령 기본정보. params: {law_id: "001706", full: true, include: "history,cases,xref"}
- law.history: 개정 연혁. params: {law_id: "001706"}
- law.byulpyo: 별표 조회. params: {law_id: "001706"}
- law.diff: 신구법 대조. params: {law_id: "001706"}
- law.verify: 조문 인용 검증 (환각 방지). params: {q: "민법 제750조"}. exists=true/false 반환.
- case.hsearch: 판례 하이브리드 검색 (키워드+벡터+리랭킹). params: {q: "임대차 보증금"}
- case.search: 판례 키워드 검색. params: {q: "임대차"}
- case.view: 판례 상세 (판결요지, 참조조문). params: {case_id: "..."}
- case.text: 판례 전문 텍스트 검색. params: {q: "..."}
- case.vsearch: 판례 시맨틱 검색. params: {q: "..."}
- case.by-law: 법령별 판례. params: {law_id: "001706"}
- case.verify: 판례 인용 검증 (환각 방지). params: {q: "2017두47045"}. exists=true/false 반환.
- bill.search: 의안 검색. params: {q: "형법"}
- bill.detail: 의안 상세. params: {bill_id: "PRC_..."}
- bill.sponsors: 발의자 정보. params: {bill_id: "PRC_..."}
- bill.vote: 표결 현황. params: {bill_id: "PRC_..."}
- bill.minutes: 회의록. params: {bill_id: "PRC_..."}
- graph.xref: 법령 인용관계. params: {law_id: "001706", cited_by: true}
- graph.timeline: 입법 타임라인. params: {law_id: "001706"}
- graph.neighbors: 그래프 노드 연결. params: {law_id: "001706"}
- search.keyword: 조문 키워드 검색. params: {q: "화학물질"}
- search.semantic: 자연어 시맨틱 검색. params: {q: "..."}
- search.ordinance: 자치법규 검색. params: {q: "주차장"}
- search.treaty: 조약 검색. params: {q: "..."}
- ref.doc: 참고문서 검색. params: {q: "법령입안심사기준"}
- help.schema: API 전체 스키마. params: {}
- help.stats: DB 현황. params: {}
- sendFeedback: 피드백 (2단계). 1차: params: {message} → ticket_id 발급 + 사용자에게 보여줄 내용 반환. 사용자에게 보여주고 동의 받기. 2차: params: {message, ticket_id} → 저장. ticket_id 없이는 저장 안 됨.

공통 파라미터:
- include=history,cases,xref,bills,timeline (추가 데이터 병합)
- count=true (본문 없이 건수만 반환)
URL path/query에 한글이나 공백이 포함되면 반드시 percent-encode 하세요.
unit_level: JO=조, HANG=항, HO=호, MOK=목
law_id는 6자리 숫자 (예: 001706=민법, 001692=형법)`,
  inputSchema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: '명령어 (권장: law.find, case.hsearch, help.schema 등)' },
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
  const contentLength = parseInt(request.headers.get('Content-Length') || '0', 10);
  if (contentLength > 102400) return json({ ok: false, error: 'payload_too_large' }, 413);
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
    // Validate tool name — canonical name is '법망'
    const toolName = params?.name;
    if (toolName && toolName !== '법망') {
      return mcpOk(id, { content: [{ type: 'text', text: JSON.stringify({
        error_type: 'invalid_tool_name',
        retryable: true,
        message: 'Tool not found: ' + toolName,
        canonical_name: '법망',
        hint: 'Retry with tool name "법망"'
      }) }], isError: true });
    }
    // Extract command + params from arguments
    const args = params?.arguments || {};
    const command = args.command;
    const p = args.params || {};
    // Parameter alias mapping for low-effort models
    if (p.article_label && !p.label) p.label = p.article_label;
    if (p.query && !p.q) p.q = p.query;
    if (p.id && !p.law_id) p.law_id = p.id;
    const availableCommands = TOOL_COMMANDS.join(', ');
    if (!command) return mcpOk(id, { content: [{ type: 'text', text: JSON.stringify({
      error_type: 'missing_command',
      retryable: true,
      message: 'Missing "command" field',
      available_commands: TOOL_COMMANDS,
      example: { command: 'law.find', params: { q: '민법' } }
    }) }], isError: true });
    if (!TOOL_COMMANDS.includes(command)) return mcpOk(id, { content: [{ type: 'text', text: JSON.stringify({
      error_type: 'unknown_command',
      retryable: true,
      message: 'Unknown command: ' + command,
      available_commands: TOOL_COMMANDS,
      hint: 'Use one of the available commands'
    }) }], isError: true });

    // Handle sendFeedback — 2-step consent flow
    if (command === 'sendFeedback') {
      const msg = (p.message || '').slice(0, 1000);
      if (!msg) return mcpOk(id, { content: [{ type: 'text', text: 'Error: message required' }], isError: true });

      // Step 2: ticket_id 있으면 → 검증 후 저장
      if (p.ticket_id) {
        const ticketKey = 'fb_ticket:' + p.ticket_id;
        const ticket = await env.API_KV.get(ticketKey);
        if (!ticket) return mcpOk(id, { content: [{ type: 'text', text: JSON.stringify({ error_type: 'invalid_ticket', message: 'ticket_id가 유효하지 않거나 만료되었습니다. sendFeedback을 ticket_id 없이 다시 호출하세요.' }) }], isError: true });
        await env.API_KV.delete(ticketKey);
        const mcpIp = request.headers.get('CF-Connecting-IP') || '';
        const ipForHash = /^[\d.:a-fA-F]{3,45}$/.test(mcpIp) ? mcpIp : 'invalid';
        const ipAnon = await anonymizeIp(ipForHash, env.FEEDBACK_KEY || 'default-salt');
        const entry = { message: msg, type: p.type || 'general', event_type: p.event_type || '', query: p.query || '', endpoint: p.endpoint || '', ip_hash: ipAnon, ts: new Date().toISOString(), source: 'mcp', ticket_id: p.ticket_id };
        await env.API_KV.put('fb:' + Date.now() + ':' + Math.random().toString(36).slice(2, 6), JSON.stringify(entry), { expirationTtl: 86400 * 90 });
        return mcpOk(id, { content: [{ type: 'text', text: '피드백이 전송되었습니다. 감사합니다.' }] });
      }

      // Step 1: ticket_id 없으면 → 발급 + 사용자 승인 요청
      const ticketId = crypto.randomUUID();
      await env.API_KV.put('fb_ticket:' + ticketId, JSON.stringify({ message: msg, ts: Date.now() }), { expirationTtl: 300 });
      return mcpOk(id, { content: [{ type: 'text', text: JSON.stringify({
        action_required: 'user_consent',
        ticket_id: ticketId,
        expires_in: '5분',
        instruction: '아래 내용을 사용자에게 그대로 보여주고, 전송 여부를 물어보세요. 사용자가 동의하면 같은 sendFeedback을 ticket_id와 함께 다시 호출하세요. 거부하면 아무것도 하지 마세요.',
        preview: { message: msg, type: p.type || 'general', event_type: p.event_type || '', query: p.query || '', note: '위 내용만 전송됩니다. 대화 내용이나 계정 정보는 포함되지 않습니다.' }
      }) }] });
    }

    try {
      const isV3Command = Object.prototype.hasOwnProperty.call(V3_COMMANDS, command);
      const originUrl = isV3Command ? buildV3Url(env.ORIGIN_BASE, command, p) : buildOriginUrl(env.ORIGIN_BASE, command, p);
      if (!originUrl) {
        const errMsg = command === 'getArticle'
          ? {error_type:'invalid_argument',retryable:true,message:'getArticle requires law_id and (article_label or article_path)',example:{command:'getArticle',params:{law_id:'001706',article_label:'제750조'}}}
          : {error_type:'invalid_argument',retryable:true,message:'Missing required parameters for ' + command,command};
        return mcpOk(id, { content: [{ type: 'text', text: JSON.stringify(errMsg) }], isError: true });
      }
      const originData = await fetchOriginNormalized(originUrl, 'beopmang-mcp/1.0', command);
      if (!originData.ok) {
        const enriched = { error_type: 'origin_error', retryable: true, command, ...originData.errorPayload };
        return mcpOk(id, { content: [{ type: 'text', text: JSON.stringify(enriched) }], isError: true });
      }
      if (!isV3Command && (!originData.result || originData.result === '')) {
        return mcpOk(id, { content: [{ type: 'text', text: JSON.stringify({
          error_type: 'empty_result',
          retryable: true,
          message: 'No results. Try v3 command: law.find with params {q: "검색어"}',
          hint: 'Legacy commands (findLaw, getLaw etc) are deprecated. Use law.find, law.explore, law.article instead.'
        }) }], isError: true });
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
      return mcpOk(id, { content: [{ type: 'text', text: JSON.stringify({ error_type: 'internal_error', retryable: true, message: 'Internal error', command }) }], isError: true });
    }
  }

  return mcpErr(id, -32601, 'Method not found: ' + method);
}
