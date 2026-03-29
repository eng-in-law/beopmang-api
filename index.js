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
  'search.local-ordinance': { endpoint: 'search', action: 'local-ordinance' },
  'search.regions': { endpoint: 'search', action: 'regions' },
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
const CATALOG_CHOSUNGS = ['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅅ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const CATALOG_CATEGORIES = [
  // 법령
  { slug: 'constitution', label: '헌법', count: 1, single: true },
  { slug: 'acts', label: '법률', filter: (l) => l.type === '법률' },
  { slug: 'presidential-decrees', label: '대통령령', filter: (l) => l.type === '대통령령' },
  { slug: 'ordinances', label: '총리령·부령', filter: (l) => /총리령|부령/.test(l.type) },
  { slug: 'regulations', label: '헌법기관 규칙', filter: (l) => /규칙/.test(l.type), single: true },
  // 행정규칙 (하위 분류)
  { slug: 'administrative-rules', label: '행정규칙', listType: 'admrul', count: 23829 },
  // 자치법규 (하위 분류)
  { slug: 'local-ordinances', label: '자치법규 — 조례', count: 13760, regional: true, ordinanceType: 'C0001' },
  { slug: 'local-rules', label: '자치법규 — 규칙', count: 4794, regional: true, ordinanceType: 'C0002' },
  // 조약
  { slug: 'treaties-bilateral', label: '조약 — 양자', listType: 'treaty', treatyCls: '1', count: 2841 },
  { slug: 'treaties-multilateral', label: '조약 — 다자', listType: 'treaty', treatyCls: '2', count: 751 },
  // 의안
  { slug: 'bills', label: '의안', listType: 'bill', count: 113894, disabled: true },
  // 해석례
  { slug: 'interpretations', label: '해석례', count: 8600, disabled: true },
];

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


async function fetchOriginNormalized(originUrl, userAgent, command, env) {
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
  const parts = path.split('/').filter(Boolean).map((part) => {
    try {
      return decodeURIComponent(part);
    } catch {
      return part;
    }
  });
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
    if (path === '/about') {
      return handleAbout(env);
    }
    if (path.startsWith('/catalog')) {
      const ua = request.headers.get('User-Agent') || '';
      if (/(GPTBot|ChatGPT|ClaudeBot|Anthropic|PerplexityBot|Google-Extended|Bytespider|Meta-ExternalAgent)/i.test(ua)) {
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
      const catalogUrls = ['/catalog'];
      CATALOG_CATEGORIES.forEach((cat) => {
        if (cat.disabled) return;
        catalogUrls.push('/catalog/' + cat.slug);
        if (cat.regional) {
          ['서울특별시','부산광역시','대구광역시','인천광역시','광주광역시','대전광역시','울산광역시','세종특별자치시','경기도','강원특별자치도','충청북도','충청남도','전북특별자치도','전라남도','경상북도','경상남도','제주특별자치도'].forEach((s) => {
            catalogUrls.push('/catalog/' + cat.slug + '/' + encodeURIComponent(s));
          });
        } else if (!cat.single) {
          CATALOG_CHOSUNGS.forEach((cho) => {
            catalogUrls.push('/catalog/' + cat.slug + '/' + cho);
          });
        }
      });
      const urls = ['/', '/about', '/privacy', ...catalogUrls];
      const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
        urls.map(u => '  <url><loc>https://api.beopmang.org' + u + '</loc><changefreq>daily</changefreq></url>').join('\n') +
        '\n</urlset>';
      return new Response(xml, { headers: { 'Content-Type': 'application/xml' } });
    }

    if (path === '/' || path === '') {
      const accept = request.headers.get('Accept') || '';
      const wantsJson = accept === 'application/json' || (accept.startsWith('application/json') && !accept.includes('text/html'));
      if (!wantsJson) {
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
          '/api/v3/search': 'keyword, semantic, local-ordinance, treaty',
          '/api/v3/ref': 'doc',
          '/api/v3/help': 'schema, stats',
        },
        usage: '/api/v3/{endpoint}?action={action}&{params}. 예: /api/v3/law?action=find&q=민법',
        params: {
          'action': '필수 — 엔드포인트별 작업 지정',
          'include': 'history,cases,xref,bills,timeline — 추가 데이터 병합',
        },
        note: '한글 query는 반드시 percent-encode. 예: /api/v3/law?action=find&q=%EB%AF%BC%EB%B2%95',
        feedback: 'POST /feedback — {message: "내용"} → ticket_id 발급 → {message, ticket_id} 재호출로 저장. 2단계 동의 방식.',
        mcp: '/mcp (ChatGPT MCP 서버)',
        claude: 'web_fetch 대신 bash 도구로 curl 사용. 네트워크 차단 시 사용자에게 안내: 설정→기능→코드 실행 ON→네트워크 송신 허용 ON→추가 허용 도메인에 api.beopmang.org 추가',
        legacy: 'v1/v2 종료, /api/v3/ 사용',
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
      return Response.redirect('https://api.beopmang.org/api/v3/help?action=schema', 301);
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
      if (url.searchParams.has('query') && !url.searchParams.has('q')) url.searchParams.set('q', url.searchParams.get('query'));
      if (url.searchParams.has('id') && !url.searchParams.has('law_id')) url.searchParams.set('law_id', url.searchParams.get('id'));
      if (url.searchParams.has('article_label') && !url.searchParams.has('label')) url.searchParams.set('label', url.searchParams.get('article_label'));
      try {
        const originResp = await fetch(env.ORIGIN_BASE + path + '?' + url.searchParams.toString(), {
          headers: { 'User-Agent': 'beopmang-api/1.0' },
          cf: { cacheTtl: 0 },
          signal: AbortSignal.timeout(30000),
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
          const action = url.searchParams.get('action') || '';
          if (action === 'article' && !originResp.ok) {
            body.hint = 'law 파라미터는 law_id(6자리 숫자)입니다. 예: law=001823. 법령명은 불가. law.find로 법령명 → law_id 변환하세요.';
          }
          if (action === 'keyword' && Array.isArray(body.data) && body.data.length === 0) {
            const q = url.searchParams.get('q') || '';
            if (q) {
              try {
                const findResp = await fetch(env.ORIGIN_BASE + '/api/v3/law?action=find&q=' + encodeURIComponent(q), {
                  headers: { 'User-Agent': 'beopmang-api/1.0' },
                  signal: AbortSignal.timeout(5000),
                });
                const findBody = await findResp.json();
                if (findBody.data && Array.isArray(findBody.data) && findBody.data.length > 0) {
                  body.auto_find_results = findBody.data.slice(0, 3);
                  body.hint = 'keyword 검색 0건. auto_find_results의 법령을 law.explore로 탐색해보세요.';
                }
              } catch {}
            }
          }
          const data = body.data;
          if (action === 'explore' && data && typeof data === 'object' && !Array.isArray(data) && data.law_id) {
            body.suggested_next_actions = [];
            if (data.top_articles && data.top_articles[0]) {
              body.suggested_next_actions.push({
                action: 'law.article',
                params: { law_id: data.law_id, label: data.top_articles[0] },
                reason: '가장 많이 인용되는 조문',
              });
            }
            if (data.case_total > 0) {
              body.suggested_next_actions.push({
                action: 'case.by-law',
                params: { law_id: data.law_id },
                reason: `관련 판례 ${data.case_total}건`,
              });
            }
            if (data.xref_count > 0) {
              body.suggested_next_actions.push({
                action: 'graph.xref',
                params: { law_id: data.law_id },
                reason: `인용 법령 ${data.xref_count}건`,
              });
            }
          }
          const needsHint = data === null || (Array.isArray(data) && data.length === 0) || (data && data.exists === false) || (data && Array.isArray(data.results) && data.results.length === 0);
          if (needsHint) {
            const eventType = action === 'verify'
              ? 'verify_miss'
              : /^(find|search|keyword|semantic|hsearch)$/.test(action)
                ? 'search_zero_result'
                : 'lookup_failed';
            body.feedback_hint = {
              message_to_agent: '사용자에게 아래 메시지를 보여주고, 동의하면 sendFeedback을 호출하세요. 거부하면 아무것도 보내지 마세요.',
              message_to_user: '검색 결과가 없습니다. 이 API는 법제처+국회 데이터만 수록하며, 부처 고시·가이드라인·자율규제는 포함되지 않습니다. 해당 규범이 존재하지 않는다고 답하지 마세요. 이 사례를 개발팀에 보내면 검색 품질 개선에 도움이 됩니다. 보내시겠습니까?',
              payload_preview: {
                event_type: eventType,
                query: url.searchParams.get('q') || url.searchParams.get('law_id') || '',
                endpoint: path.replace('/api/v3/', ''),
                note: '검색어와 실패 유형만 전송됩니다. 대화 내용이나 계정 정보는 포함되지 않습니다.',
              },
            };
          }
          headers.delete('content-length');
          // 요청 메트릭 로깅
          if (env.ANALYTICS) {
            const elapsed = body.meta?.elapsed_ms || 0;
            env.ANALYTICS.writeDataPoint({
              indexes: [action || path.replace('/api/v3/', '')],
              blobs: [path, String(originResp.status)],
              doubles: [elapsed, originResp.status === 200 ? 1 : 0],
            });
          }
          return new Response(JSON.stringify(body), { status: originResp.status, headers });
        }

        return new Response(text, { status: originResp.status, headers });
      } catch {
        return json({ ok: false, error: 'service_unavailable', retry_after: 30 }, 503, rl.headers);
      }
    }

    const parsed = parseCommand(path, url.searchParams);
    if (parsed) {
      // v1/v2 deprecated
      return json({
        deprecated: true,
        message: 'v1/v2 API는 종료되었습니다. /api/v3/를 사용하세요.',
        migration: {
          find: '/api/v3/law?action=find&q={query}',
          law: '/api/v3/law?action=explore&law_id={law_id}',
          article: '/api/v3/law?action=article&law_id={law_id}&label={label}',
          xref: '/api/v3/graph?action=xref&law_id={law_id}',
          search: '/api/v3/search?action=keyword&q={query}'
        },
        docs: 'https://api.beopmang.org/api/v3/help?action=schema'
      }, 410, rl.headers);
    }

    return json({ ok: false, error: 'not_found', hint: 'GET / for API info' }, 404, rl.headers);
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

async function handleAbout(env) {
  let stats = {};
  try {
    const cached = await env.API_KV.get('about:stats');
    if (cached) {
      stats = JSON.parse(cached);
    } else {
      const r = await fetch(env.ORIGIN_BASE + '/api/v3/help?action=stats', { signal: AbortSignal.timeout(5000) });
      const d = await r.json();
      stats = d?.data || {};
      env.API_KV.put('about:stats', JSON.stringify(stats), { expirationTtl: 3600 }).catch(() => {});
    }
  } catch {}

  const n = (k, fallback) => Number(stats[k] || fallback || 0).toLocaleString('ko-KR');
  const pageTitle = '법망 API — 데이터 카탈로그';
  const metaDescription = '법령·판례·의안·조약·행정규칙·자치법규 구조화 데이터 API';
  const canonicalUrl = 'https://api.beopmang.org/about';
  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: pageTitle,
    description: metaDescription,
    url: canonicalUrl,
  });
  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtmlW(pageTitle)}</title>
<meta name="description" content="${escapeHtmlW(metaDescription)}">
<meta property="og:title" content="${escapeHtmlW(pageTitle)}">
<meta property="og:description" content="${escapeHtmlW(metaDescription)}">
<meta property="og:url" content="${escapeHtmlW(canonicalUrl)}">
<meta property="og:image" content="https://api.beopmang.org/og.jpg">
<meta property="og:type" content="website">
<meta property="og:site_name" content="법망">
<link rel="canonical" href="${escapeHtmlW(canonicalUrl)}">
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
.shell { max-width: 560px; width: 100%; padding-top: 24px; padding-bottom: 40px; }
.card {
  background: var(--surface); border: 3px solid var(--border);
  border-radius: 0; box-shadow: 12px 12px 0 var(--border); overflow: hidden;
}
.card-header { padding: 24px 24px 20px; border-bottom: 2px solid var(--border); }
.card-header h1 { margin: 0; font-size: 1.15rem; font-weight: 800; letter-spacing: -0.03em; }
.card-desc { margin: 6px 0 0; font-size: 0.85rem; color: var(--ink); }
.card-body { padding: 28px 24px 40px; }

.about-section { margin-bottom: 20px; }
.about-section h3 { font-size: 0.95rem; font-weight: 800; margin: 0 0 8px; }
.about-list { list-style: none; padding: 0; margin: 0; }
.about-list li { font-size: 0.85rem; padding: 4px 0; border-bottom: 1px solid rgba(59,47,32,0.1); }
.about-list li::before { content: '- '; font-weight: 700; }
.about-ol { list-style: none; counter-reset: about-counter; }
.about-ol li::before { content: counter(about-counter) ') '; counter-increment: about-counter; font-weight: 700; }
.about-list li strong { font-weight: 700; }

.statusline {
  margin: 24px 0 0; text-align: right;
  font-size: 0.72rem; color: var(--ink); font-weight: 600;
}
.statusline p { margin: 0; }

@media (max-width: 640px) {
  .page { padding: 10px 16px 20px; }
  .card { box-shadow: 8px 8px 0 var(--border); }
  .card-header { padding: 20px 18px 16px; }
  .card-body { padding: 18px 18px 32px; }
}
</style>
<script type="application/ld+json">${jsonLd}</script>
</head>
<body class="page">
<main class="shell">
<div class="card">

<div class="card-header">
<h1>🦒 법망 API</h1>
<p class="card-desc">대한민국 법령을 AI 에이전트가 간편하게 참조할 수 있도록 돕는 무료 API입니다.</p>
</div>

<div class="card-body">
<section class="about-section">
<h3>0. 요약</h3>
<ol class="about-list about-ol">
<li><span>국가법령정보센터 제공 법령 99.9%+ 수록, 매주 토요일 최신 동기화</span></li>
<li><span>XML, HWP, PDF 사전 파싱 — 표 데이터 포함 모든 출력 JSON</span></li>
<li><span>PostgreSQL + pgvector, 주요 조문 20만건 임베딩(768d) — semantic search 지원</span></li>
<li><span>인증키 필요 없는 REST API, rate limit 100회/분</span></li>
<li><span>로그인, IP, 쿼리 등 로깅 없음, 익명 엔드포인트 호출 빈도만 집계</span></li>
</ol>
</section>

<section class="about-section">
<h3>1. 수록 데이터 범위</h3>
<ul class="about-list">
<li><span>법령 ${n('법령합계', 5573)}건 · 판례 ${n('판례', 171451)}건 · 의안 ${n('의안', 113894)}건 · 행정규칙 ${n('행정규칙', 23829)}건</span></li>
<li><span>조약 ${n('조약', 3596)}건 (양자 ${n('조약_양자', 2841)} / 다자 ${n('조약_다자', 751)}) · 해석례 ${n('해석례', 8600)}건 · 자치법규 ${n('조례', 18842)}건</span></li>
<li><span>인용관계 ${n('법령인용관계', 132707)}건 · 연혁 ${n('연혁', 100357)}건</span></li>
<li><span>출처: 법제처 Open API, 국회 Open API</span></li>
</ul>
</section>

<section class="about-section">
<h3>2. 제공 데이터 형식</h3>
<ul class="about-list">
<li><span>법제처 XML 원본을 파싱하여 전 항목 JSON 구조화</span></li>
<li><span>별표·서식: 5,622개 법령, 12,120건 — HWP/PDF 원본을 JSON 테이블 구조로 변환 (표 rowspan/colspan 보존)</span></li>
<li><span>조문 단위 분해: 편-장-절-관-조-항-호-목 계층 ${n('조문', 1190000)}건</span></li>
</ul>
</section>

<section class="about-section">
<h3>3. 검색 시스템</h3>
<ul class="about-list">
<li><span>Cloudflare Workers + PostgreSQL</span></li>
<li><span>keyword / semantic / hybrid search 3종 지원</span></li>
<li><span>semantic: 정확한 키워드 대신 "임차인 보호 요건"처럼 의미로 검색</span></li>
</ul>
</section>

<section class="about-section">
<h3>4. 인터페이스</h3>
<ul class="about-list">
<li><span>REST API (7개 엔드포인트, 28개 action) · MCP 서버 제공</span></li>
<li><span>환각 방지용 인용 검증 기능 지원</span></li>
<li><span>종합 조회 기능 지원 — 법령 1회 요청으로 조문, 판례, 의안, 인용 법령까지 한 번에 반환</span></li>
</ul>
</section>

<section class="about-section">
<h3>5. 개인정보 보호</h3>
<ul class="about-list">
<li><span>인증키·로그인·회원가입 불필요</span></li>
<li><span>IP 주소, User-Agent 등 개인 식별 가능 정보 일체 수집하지 않음</span></li>
<li><span>요청 본문(검색어 포함) 서버에 저장하지 않음</span></li>
<li><span>익명 엔드포인트별 호출 빈도만 집계 (서비스 안정성 모니터링 목적)</span></li>
<li><span>피드백은 반드시 사용자 승낙 후 전송 — 에이전트 단독 발신 불가</span></li>
</ul>
</section>

<section class="about-section">
<h3>6. Acknowledgement</h3>
<ul class="about-list">
<li><span>대한민국 법령의 SSOT, 국가법령정보센터를 운영해주시는 법제처에 감사드립니다.</span></li>
</ul>
</section>

<div hidden aria-hidden="true">/about</div>
</div>
</div>

<div class="statusline">
<p>IP, 검색어, 개인정보 등은 일절 수집하지 않으며, 익명 엔드포인트 호출 빈도만 집계합니다.</p>
<p>API 출력(법제처, 국회 출처)은 참고용으로 법적 효력이 없습니다.</p>
<p>help@beopmang.org</p>
</div>
</main>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}

async function handleCatalog(path, env) {
  const catalogCounts = {
    constitution: 1,
    acts: 5573,
    'presidential-decrees': 0,
    ordinances: 0,
    regulations: 0,
    'administrative-rules': 23829,
    treaties: 3260,
  };

  async function fetchCatalogList(cacheKey, url) {
    let items = null;
    const cached = await env.API_KV.get(cacheKey);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) items = parsed;
        else if (Array.isArray(parsed?.data)) items = parsed.data;
        else if (Array.isArray(parsed?.data?.results)) items = parsed.data.results;
        else if (Array.isArray(parsed?.result)) items = parsed.result;
        else if (Array.isArray(parsed?.results)) items = parsed.results;
        else items = null;
      } catch {
        items = null;
      }
    }
    if (Array.isArray(items)) return items;
    try {
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'beopmang-api/catalog' },
        cf: { cacheTtl: 0 },
        signal: AbortSignal.timeout(30000),
      });
      const text = await resp.text();
      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
      if (Array.isArray(payload)) items = payload;
      else if (Array.isArray(payload?.data)) items = payload.data;
      else if (Array.isArray(payload?.data?.results)) items = payload.data.results;
      else if (Array.isArray(payload?.result)) items = payload.result;
      else if (Array.isArray(payload?.results)) items = payload.results;
      else items = [];
      env.API_KV.put(cacheKey, JSON.stringify(items), { expirationTtl: 3600 }).catch(() => {});
      return items;
    } catch {
      return [];
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

  function formatDateLabel(value) {
    const raw = String(value || '').trim().slice(0, 10);
    const parts = raw.split('-');
    if (parts.length !== 3) return '';
    const [y, m, d] = parts;
    if (!/^\d{4}$/.test(y) || !/^\d{2}$/.test(m) || !/^\d{2}$/.test(d)) return '';
    return `${y}. ${parseInt(m, 10)}. ${parseInt(d, 10)}.`;
  }

  let selectedCho = 'ㄱ';
  const parts = path.split('/').filter(Boolean).map((part) => {
    try {
      return decodeURIComponent(part);
    } catch {
      return part;
    }
  });
  const isCatalogHome = path === '/catalog';
  const sectionAliases = { laws: 'laws', rules: 'administrative-rules' };
  const catalogSection = parts[0] === 'catalog' ? (sectionAliases[parts[1]] || parts[1] || 'home') : 'home';
  if (CATALOG_CHOSUNGS.includes(parts[2])) {
    selectedCho = parts[2];
  }

  let lastSynced = '';
  try {
    lastSynced = (await env.API_KV.get('stats:last_synced')) || '';
    if (!lastSynced) {
      const s = await fetch(env.ORIGIN_BASE + '/api/v3/help?action=stats', { signal: AbortSignal.timeout(3000) });
      const sd = await s.json();
      lastSynced = sd?.data?.last_synced || '';
      if (lastSynced) env.API_KV.put('stats:last_synced', lastSynced, { expirationTtl: 3600 }).catch(() => {});
    }
  } catch {}
  const lastSyncedLabel = formatDateLabel(lastSynced);

  const allLawsRaw = await fetchCatalogList('catalog:laws', env.ORIGIN_BASE + '/api/v3/law?action=list');
  const allLaws = (Array.isArray(allLawsRaw) ? allLawsRaw : [])
    .map((law) => ({
      name: String(law?.law_name || law?.name || law?.title || '').trim(),
      type: String(law?.law_type || law?.type || law?.kind || '').trim(),
      id: String(law?.law_id || law?.id || '').trim(),
      case_count: Number(law?.case_count || 0),
    }))
    .filter((law) => law.name);

  for (const cat of CATALOG_CATEGORIES) {
    if (cat.filter) catalogCounts[cat.slug] = allLaws.filter(cat.filter).length;
  }

  let currentCategory = CATALOG_CATEGORIES.find((cat) => cat.slug === catalogSection) || null;
  if (catalogSection === 'laws') {
    currentCategory = { slug: 'laws', label: '법령', single: false };
    catalogCounts.laws = allLaws.length;
  }

  let normalizedItems = [];
  let regionItems = [];
  const selectedRegion = parts[2] || '';
  let subRegionItems = [];
  const selectedSubRegion = parts[3] || '';
  if (currentCategory?.listType === 'admrul') {
    const raw = await fetchCatalogList('catalog:admrul', env.ORIGIN_BASE + '/api/v3/law?action=list&type=admrul');
    normalizedItems = (Array.isArray(raw) ? raw : [])
      .map((item) => ({
        name: String(item?.law_name || item?.name || item?.title || '').trim(),
        type: String(item?.law_type || item?.type || item?.kind || '행정규칙').trim(),
        id: String(item?.law_id || item?.id || '').trim(),
        case_count: Number(item?.case_count || 0),
      }))
      .filter((item) => item.name);
    catalogCounts['administrative-rules'] = normalizedItems.length || catalogCounts['administrative-rules'];
  } else if (currentCategory?.listType === 'treaty') {
    const clsParam = currentCategory.treatyCls ? '&cls=' + currentCategory.treatyCls : '';
    const cacheKey = 'catalog:treaty' + (currentCategory.treatyCls || '');
    const raw = await fetchCatalogList(cacheKey, env.ORIGIN_BASE + '/api/v3/search?action=treaty&q=&limit=5000' + clsParam);
    normalizedItems = (Array.isArray(raw) ? raw : raw?.results || [])
      .map((item) => ({
        name: String(item?.name || item?.treaty_name || item?.law_name || item?.title || '').trim(),
        type: String(item?.treaty_type || item?.type || item?.law_type || '조약').trim(),
        id: String(item?.treaty_id || item?.law_id || item?.id || '').trim(),
        case_count: Number(item?.case_count || 0),
      }))
      .filter((item) => item.name);
    catalogCounts[currentCategory.slug] = normalizedItems.length || catalogCounts[currentCategory.slug];
  } else if (currentCategory?.regional) {
    const typeParam = currentCategory.ordinanceType ? '&type=' + currentCategory.ordinanceType : '';
    const typeSuffix = currentCategory.ordinanceType || 'all';
    regionItems = (await fetchCatalogList('catalog:regions:' + typeSuffix, env.ORIGIN_BASE + '/api/v3/search?action=regions' + typeParam))
      .map((item) => ({
        sido: String(item?.sido || '').trim(),
        is_edu: !!item?.is_edu,
        count: Number(item?.count || 0),
      }))
      .filter((item) => item.sido);
    if (selectedRegion) {
      const regionsRaw = await fetchCatalogList(
        'catalog:regions:' + typeSuffix + ':' + selectedRegion,
        env.ORIGIN_BASE + '/api/v3/search?action=regions&sido=' + encodeURIComponent(selectedRegion) + typeParam
      );
      subRegionItems = regionsRaw
        .map((item) => ({
          sigungu: String(item?.gov || item?.sigungu || item?.name || item?.region || '').trim(),
          count: Number(item?.count || 0),
        }))
        .filter((item) => item.sigungu);
      if (selectedSubRegion) {
        // gov 파라미터로 해당 지자체 조례만 조회
        const govParam = '&gov=' + encodeURIComponent(selectedSubRegion);
        const raw = await fetchCatalogList(
          'catalog:ordin:' + typeSuffix + ':' + selectedRegion + ':' + selectedSubRegion,
          env.ORIGIN_BASE + '/api/v3/search?action=local-ordinance' + govParam + '&limit=5000' + typeParam
        );
        const rawItems = Array.isArray(raw) ? raw : raw?.results || [];
        normalizedItems = rawItems
          .map((item) => ({
            name: String(item?.ordin_name || item?.name || item?.law_name || item?.title || '').trim(),
            type: String(item?.ordin_type || item?.org || item?.type || '조례').trim(),
            id: String(item?.ordin_id || item?.id || item?.law_id || '').trim(),
            case_count: Number(item?.case_count || 0),
          }))
          .filter((item) => item.name);
      }
    }
  } else if (currentCategory?.filter) {
    normalizedItems = allLaws.filter(currentCategory.filter);
  } else if (catalogSection === 'laws') {
    normalizedItems = allLaws;
  }

  normalizedItems.sort((a, b) => a.name.localeCompare(b.name, 'ko'));

  const grouped = Object.fromEntries(CATALOG_CHOSUNGS.map((cho) => [cho, []]));
  for (const law of normalizedItems) {
    const cho = getChosung((law.name || '')[0] || '');
    if (grouped[cho]) grouped[cho].push(law);
  }

  const isSingleCategory = !!currentCategory?.single;
  const isRegionalCategory = !!currentCategory?.regional;
  const isRegionalRoot = isRegionalCategory && !selectedRegion;
  const isRegionalRegionPage = isRegionalCategory && !!selectedRegion && !selectedSubRegion;
  const isRegionalSubRegionPage = isRegionalCategory && !!selectedRegion && !!selectedSubRegion;
  const currentItems = isSingleCategory || isRegionalSubRegionPage ? normalizedItems : (grouped[selectedCho] || []);
  const topLaws = [...currentItems].sort((a, b) => (b.case_count || 0) - (a.case_count || 0)).slice(0, 3);
  const examples = topLaws.map((law) => law.name).join(', ');
  const currentLabel = currentCategory?.label || '법령';
  let listDescription = '';
  let headerDescription = '';
  if (isRegionalRoot) {
    listDescription = `시도별 조례 목록${regionItems.length > 0 ? ` · ${regionItems.length}곳` : ''}`;
    headerDescription = lastSyncedLabel ? `${lastSyncedLabel} 기준 · 시도별 조례 목록` : '시도별 조례 목록';
  } else if (isRegionalRegionPage) {
    listDescription = `${selectedRegion} 시군구별 조례 목록${subRegionItems.length > 0 ? ` · ${subRegionItems.length}곳` : ''}`;
    headerDescription = lastSyncedLabel ? `${lastSyncedLabel} 기준 · ${selectedRegion} 시군구별 조례 목록` : `${selectedRegion} 시군구별 조례 목록`;
  } else if (isRegionalSubRegionPage) {
    listDescription = `${selectedRegion} ${selectedSubRegion} 조례 ${currentItems.length}건${examples ? `. ${examples} 등.` : '.'}`;
    headerDescription = lastSyncedLabel ? `${lastSyncedLabel} 기준 · ${selectedRegion} ${selectedSubRegion} 조례 ${currentItems.length}건` : `${selectedRegion} ${selectedSubRegion} 조례 ${currentItems.length}건`;
  } else if (isSingleCategory) {
    listDescription = `${currentLabel} ${currentItems.length}건${examples ? `. ${examples} 등.` : '.'}`;
    headerDescription = lastSyncedLabel ? `${lastSyncedLabel} 기준 · ${currentLabel} ${currentItems.length}건` : `${currentLabel} ${currentItems.length}건`;
  } else {
    listDescription = `${selectedCho}으로 시작하는 ${currentLabel} ${currentItems.length}건${examples ? `. ${examples} 등.` : '.'}`;
    headerDescription = lastSyncedLabel ? `${lastSyncedLabel} 기준 · ${selectedCho}으로 시작하는 ${currentLabel} ${currentItems.length}건` : `${selectedCho}으로 시작하는 ${currentLabel} ${currentItems.length}건`;
  }

  const choNav = CATALOG_CHOSUNGS.map((cho) => {
    const count = (grouped[cho] || []).length;
    const classes = ['cho-link'];
    if (cho === selectedCho) classes.push('active');
    else if (count === 0) classes.push('empty');
    const targetSlug = currentCategory?.slug === 'laws' ? 'laws' : currentCategory?.slug;
    return `<a href="/catalog/${targetSlug}/${encodeURIComponent(cho)}" class="${classes.join(' ')}">${cho}${count > 0 ? ` <small>${count}</small>` : ''}</a>`;
  }).join('\n');

  const lawList = currentItems.length > 0
    ? currentItems.map((law) => `<li class="law-item"><span class="law-name">${escapeHtmlW(law.name)}</span><span class="law-type">${escapeHtmlW(law.type || currentLabel)}</span></li>`).join('\n')
    : `<li class="law-item"><span class="law-name">${isRegionalSubRegionPage ? '해당 시군구의 조례가 없습니다.' : isRegionalCategory ? '해당 시도의 조례가 없습니다.' : isSingleCategory ? `${currentLabel} 목록이 없습니다.` : '해당 초성으로 시작하는 법령이 없습니다.'}</span><span class="law-type">-</span></li>`;

  const regionNav = regionItems.length > 0
    ? `<nav class="chosung-nav">
${regionItems.map((region) => {
      const classes = ['cho-link'];
      if (region.sido === selectedRegion) classes.push('active');
      const label = region.is_edu ? `${region.sido} 교육청` : region.sido;
      return `<a href="/catalog/local-ordinances/${encodeURIComponent(region.sido)}" class="${classes.join(' ')}">${escapeHtmlW(label)}${region.count > 0 ? ` <small>${region.count.toLocaleString('ko-KR')}</small>` : ''}</a>`;
    }).join('\n')}
</nav>`
    : '';
  const subRegionNav = subRegionItems.length > 0 && subRegionItems.length <= 25
    ? `<nav class="chosung-nav">
${subRegionItems.map((region) => {
      const classes = ['cho-link'];
      if (region.sigungu === selectedSubRegion) classes.push('active');
      return `<a href="/catalog/local-ordinances/${encodeURIComponent(selectedRegion)}/${encodeURIComponent(region.sigungu)}" class="${classes.join(' ')}">${escapeHtmlW(region.sigungu)}${region.count > 0 ? ` <small>${region.count.toLocaleString('ko-KR')}</small>` : ''}</a>`;
    }).join('\n')}
</nav>`
    : '';

  const categoriesHtml = `<div class="categories">
${CATALOG_CATEGORIES.map((cat) => {
    const classes = ['cat-btn'];
    if (cat.disabled) classes.push('disabled');
    if (currentCategory?.slug === cat.slug) classes.push('active');
    return `<a href="/catalog/${cat.slug}" class="${classes.join(' ')}"${cat.disabled ? ' aria-disabled="true"' : ''}>${escapeHtmlW(cat.label)}${cat.count || catalogCounts[cat.slug] ? ` <span class="count-badge">${Number(cat.count || catalogCounts[cat.slug] || 0).toLocaleString('ko-KR')}</span>` : ''}</a>`;
  }).join('\n')}
</div>`;

  let pageTitle = isRegionalRoot
    ? '조례 — 시도별 목록 — 법망 카탈로그'
    : isRegionalRegionPage
    ? `${selectedRegion} 조례 — 시군구별 목록 — 법망 카탈로그`
    : isRegionalSubRegionPage
    ? `${selectedRegion} ${selectedSubRegion} 조례 — 법망 카탈로그`
    : isSingleCategory
    ? `${currentLabel} — 법망 카탈로그`
    : `${selectedCho}으로 시작하는 ${currentLabel} — 법망 카탈로그`;
  let metaDescription = listDescription;
  let cardDesc = headerDescription;
  let bodyContent = `${categoriesHtml}

<nav class="chosung-nav">
${choNav}
</nav>

<ul class="law-list">
${lawList}
</ul>`;

  if (isCatalogHome) {
    pageTitle = '법망 API 법령정보 목록 — 법망';
    metaDescription = lastSyncedLabel ? `${lastSyncedLabel} 기준` : '대한민국 현행 법령 5,573건 · 행정규칙 23,829건 · 조약 3,596건 가나다순 목록';
    cardDesc = '대한민국 현행 법령 가나다순 목록';
    bodyContent = categoriesHtml;
  } else if (isRegionalRoot) {
    pageTitle = '조례 — 시도별 목록 — 법망 카탈로그';
    metaDescription = lastSyncedLabel ? `${lastSyncedLabel} 기준` : '조례 시도별 목록';
    cardDesc = lastSyncedLabel ? `${lastSyncedLabel} 기준 · 시도별 조례 목록` : '시도별 조례 목록';
    bodyContent = `${categoriesHtml}

<ul class="law-list">
${regionItems.length > 0 ? regionItems.map((region) => {
      const label = region.is_edu ? `${region.sido} 교육청` : region.sido;
      return `<li class="law-item"><span class="law-name"><a href="/catalog/local-ordinances/${encodeURIComponent(region.sido)}" style="color:inherit;text-decoration:none">${escapeHtmlW(label)}</a></span><span class="law-type">${region.count.toLocaleString('ko-KR')}건</span></li>`;
    }).join('\n') : '<li class="law-item"><span class="law-name">시도 목록이 없습니다.</span><span class="law-type">-</span></li>'}
</ul>`;
  } else if (isRegionalRegionPage) {
    pageTitle = `${selectedRegion} 조례 — 시군구별 목록 — 법망 카탈로그`;
    metaDescription = lastSyncedLabel ? `${lastSyncedLabel} 기준 · ${selectedRegion} 시군구별 조례 목록` : `${selectedRegion} 시군구별 조례 목록`;
    cardDesc = lastSyncedLabel ? `${lastSyncedLabel} 기준 · ${selectedRegion} 시군구별 조례 목록` : `${selectedRegion} 시군구별 조례 목록`;
    bodyContent = `${categoriesHtml}

${regionNav}

<ul class="law-list">
${subRegionItems.length > 0 ? subRegionItems.map((region) => `<li class="law-item"><span class="law-name"><a href="/catalog/local-ordinances/${encodeURIComponent(selectedRegion)}/${encodeURIComponent(region.sigungu)}" style="color:inherit;text-decoration:none">${escapeHtmlW(region.sigungu)}</a></span><span class="law-type">${region.count.toLocaleString('ko-KR')}건</span></li>`).join('\n') : `<li class="law-item"><span class="law-name">${escapeHtmlW(selectedRegion)}의 시군구 목록이 없습니다.</span><span class="law-type">-</span></li>`}
</ul>`;
  } else if (isRegionalSubRegionPage) {
    bodyContent = `${categoriesHtml}

${subRegionNav}

<ul class="law-list">
${lawList}
</ul>`;
  } else if (!currentCategory || currentCategory.disabled) {
    const sectionName = currentCategory?.label || '카탈로그';
    pageTitle = `${sectionName} 카탈로그 — 법망`;
    metaDescription = `${sectionName} 카탈로그 준비 중`;
    cardDesc = `${sectionName} 카탈로그 준비 중`;
    bodyContent = `${categoriesHtml}

<ul class="law-list">
<li class="law-item"><span class="law-name">${sectionName} 카탈로그는 준비 중입니다.</span><span class="law-type">준비 중</span></li>
</ul>`;
  }

  const canonicalUrl = `https://api.beopmang.org${path}`;
  const itemListJsonLd = (!isCatalogHome && currentCategory && !currentCategory.disabled)
    ? `<script type="application/ld+json">${JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        name: pageTitle,
        numberOfItems: currentItems.length,
        itemListElement: [...currentItems].sort((a, b) => (b.case_count || 0) - (a.case_count || 0)).slice(0, 20).map((law, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          name: law.name,
        })),
      })}</script>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtmlW(pageTitle)}</title>
<meta name="description" content="${escapeHtmlW(metaDescription)}">
<meta property="og:title" content="${escapeHtmlW(pageTitle)}">
<meta property="og:description" content="${escapeHtmlW(metaDescription)}">
<meta property="og:url" content="${escapeHtmlW(canonicalUrl)}">
<meta property="og:image" content="https://api.beopmang.org/og.jpg">
<meta property="og:type" content="website">
<meta property="og:site_name" content="법망">
<link rel="canonical" href="${escapeHtmlW(canonicalUrl)}">
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
.shell { max-width: 560px; width: 100%; padding-top: 24px; padding-bottom: 40px; }
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
  text-decoration: none; display: inline-block;
}
.cat-btn:hover { background: #fffdf7; transform: translate(-1px,-1px); box-shadow: 4px 4px 0 var(--border); }
.cat-btn.active { background: var(--ink); color: var(--bg); }
.cat-btn.disabled { opacity: 0.4; pointer-events: none; }

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
.statusline p { margin: 0; }

@media (max-width: 640px) {
  .page { padding: 10px 16px 20px; }
  .card { box-shadow: 8px 8px 0 var(--border); }
  .card-header { padding: 20px 18px 16px; }
.card-body { padding: 18px 18px 32px; }
}
</style>
${itemListJsonLd}
</head>
<body class="page">
<main class="shell">
<div class="card">

<div class="card-header">
<h1>🦒 법망 API 법령정보 목록</h1>
<p class="card-desc">${escapeHtmlW(cardDesc)}</p>
</div>

<div class="card-body">
${bodyContent}

</div>
</div>

<div class="statusline">
<p>IP, 검색어, 개인정보 등은 일절 수집하지 않으며, 익명 엔드포인트 호출 빈도만 집계합니다.</p>
<p>API 출력(법제처, 국회 출처)은 참고용으로 법적 효력이 없습니다.</p>
<p>help@beopmang.org</p>
</div>
</main>
</body>
</html>`;

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, no-store',
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
.title-row { display: flex; align-items: center; gap: 10px; }
.card-header h1 { margin: 0; font-size: 1.15rem; font-weight: 800; letter-spacing: -0.03em; }
.card-desc { margin: 10px 0 0; font-size: 0.92rem; color: var(--ink); }
.card-sub { margin: 4px 0 0; font-size: 0.76rem; color: var(--muted); font-weight: 500; }
.card-body { padding: 28px 24px 56px; display: flex; flex-direction: column; gap: 24px; }

.about-link { padding: 4px 10px; border: 2px solid #3b2f20; border-radius: 0; box-shadow: 2px 2px 0 #3b2f20; transition: transform 80ms, box-shadow 80ms, background var(--motion-fast); background: #fffdf7; font-size: 0.76rem; font-weight: 700; color: var(--ink); cursor: pointer; font-family: inherit; text-decoration: none; }
.about-link:hover { background: var(--ink); color: var(--bg); }
.status-bar { display: inline-flex; align-items: center; gap: 5px; font-size: 0.62rem; color: var(--muted); padding: 0; border: none; font-weight: 500; white-space: nowrap; background: none; position: relative; top: 2px; }
.dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: var(--green); vertical-align: middle; }
.status-bar strong { color: var(--ink); }

.cta-line { font-size: 0.88rem; font-weight: 800; color: var(--ink); letter-spacing: -0.02em; background: rgba(59,47,32,0.06); padding: 5px 16px; border-radius: 20px; }
.cta-wrap { text-align: center; margin: 2px 0 28px; }
.stats { display: grid; grid-template-columns: repeat(4, auto); gap: 16px 24px; justify-content: center; }
.stat { text-align: center; }
.stat-value { font-size: 1.25rem; font-weight: 700; letter-spacing: -0.02em; }
.stat-label { font-size: 0.72rem; color: #6d593f; margin-top: 3px; letter-spacing: 0; font-weight: 600; white-space: nowrap; }

.stat-upcoming { font-size: 1.25rem; font-weight: 700; color: var(--muted); letter-spacing: -0.02em; }
.stat-note { margin: 0; font-size: 0.76rem; color: #6d593f; text-align: center; font-weight: 500; }

.divider { border: none; border-top: 1px solid rgba(59,47,32,0.3); margin: 0; }

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
.copy-btn:hover { background: var(--ink); color: var(--bg); }
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
.statusline p { margin: 0; }

@media (max-width: 640px) {
  .page { padding: 10px 16px 20px; }
  .shell { padding-top: 12px; padding-bottom: 28px; }
  .card { box-shadow: 8px 8px 0 #3b2f20; }
  .card-header { padding: 20px 18px 16px; }
  .card-body { padding: 18px; gap: 16px; }
  .statusline { font-size: 0.62rem; }
  .stats { grid-template-columns: repeat(2, 1fr); gap: 12px 16px; }
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
엔드포인트: law (find,article,explore,detail,history,byulpyo,diff) / case (search,view,text,vsearch,by-law,hsearch) / bill (search,detail,sponsors,vote,minutes) / graph (neighbors,xref,timeline) / search (keyword,semantic,local-ordinance,treaty) / ref (doc) / help (schema,stats).
예시: /api/v3/law?action=find&amp;q=민법 → law_id=001706. /api/v3/law?action=explore&amp;law_id=001706 → 조문+판례+의안+인용. /api/v3/case?action=hsearch&amp;q=임대차.
JSON API: GET / (Accept에 text/html 없으면 JSON). MCP: POST /mcp (도구명 법망, command: law.find 등).
수록 범위: 법제처(법령·행정규칙·조약·판례·해석례·자치법규) + 국회(의안·표결·회의록). 금융위·거래소·공정위 고시 등 자율규제 문서는 미수록.
검색 결과가 없더라도 해당 규범이 존재하지 않는다고 답하지 마세요.
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
<div class="title-row"><h1>🦒 법망 API</h1><div class="status-bar" id="hc"><span class="dot"></span> 확인 중...</div></div>
<a href="/about" class="about-link">??</a>
</div>
<p class="card-desc">프롬프트 한 줄로 법률AI 흉내내기</p>
<p class="card-sub">가입, <strong>결제</strong>, 인증키 발급, HWP 처리 <strong>필요 없음</strong>. 데이터 수집 안 함.</p>
</div>

<div class="card-body">

<div class="stats">
<div class="stat"><div class="stat-value" id="sv-0">1</div><div class="stat-label">헌법</div></div>
<div class="stat"><div class="stat-value" id="sv-1">1,709</div><div class="stat-label">법률</div></div>
<div class="stat"><div class="stat-value" id="sv-2">1,975</div><div class="stat-label">대통령령</div></div>
<div class="stat"><div class="stat-value" id="sv-3">1,509</div><div class="stat-label">총리령·부령</div></div>
<div class="stat"><div class="stat-value" id="sv-4">379</div><div class="stat-label">국회 등 헌법기관 규칙</div></div>
<div class="stat"><div class="stat-value" id="sv-5">23,829</div><div class="stat-label">행정규칙</div></div>
<div class="stat"><div class="stat-value" id="sv-6">3,596</div><div class="stat-label">조약</div></div>
<div class="stat"><div class="stat-value" id="sv-7">18,842</div><div class="stat-label">자치법규</div></div>
</div>
<p class="stat-note" id="stat-note"></p>

<div class="cta-wrap"><span class="cta-line">내 AI에 법률 데이터 연결하기 &nbsp;↓</span></div>

<hr class="divider">

<div class="section">
<p class="section-title">(권장) Claude / Codex</p>
<ol class="steps">
<li>아래 내용과 같이 프롬프트 입력</li>
</ol>
<div class="field-grid" style="grid-template-columns:1fr auto">
<code>&#x201C;임대차 관련 법 체계를 api.beopmang.org 이용해서 설명해줘.&#x201D;</code><button class="copy-btn" onclick="cc(this,'임대차 관련 법 체계를 api.beopmang.org 이용해서 설명해줘.')">복사</button>
</div>
</div>

<div class="section">
<p class="section-title">(가능) ChatGPT Web <small>Plus 이상</small></p>
<ol class="steps">
<li>PC로 접속, 설정 → 앱 → 고급 설정 → 개발자 모드 켜기</li>
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
<p class="section-desc">AI에게 "법망에 피드백 보내줘"라고 말하면 됩니다.</p>
</div>

</div>

</div>

</div>
<div class="statusline">
<p>IP, 검색어, 개인정보 등은 일절 수집하지 않으며, 익명 엔드포인트 호출 빈도만 집계합니다.</p>
<p>API 출력(법제처, 국회 출처)은 참고용으로 법적 효력이 없습니다.</p>
<p>help@beopmang.org</p>
</div>
</main>
<script>
function cc(el,v){navigator.clipboard.writeText(v).then(function(){el.textContent='완료';setTimeout(function(){el.textContent='복사'},1500)})}
function hc(){fetch('/health').then(function(r){return r.json()}).then(function(d){
var el=document.getElementById('hc');
if(d.status==='ok'){var now=new Date();var ts=now.getFullYear()+'. '+(now.getMonth()+1)+'. '+now.getDate()+'. '+String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0')+':'+String(now.getSeconds()).padStart(2,'0');el.innerHTML='<span class="dot" style="background:#2f6b4e"></span> 서버 원활 - '+ts;}
else{el.innerHTML='<span class="dot" style="background:#dc2626"></span> 오프라인 · 점검 중';setTimeout(hc,10000);}
}).catch(function(){document.getElementById('hc').innerHTML='<span class="dot" style="background:#d97706"></span> 확인 불가';setTimeout(hc,10000);});}
hc();setInterval(hc,60000);
fetch('/stats').then(function(r){return r.json()}).then(function(d){
var r=d.result||d;var n=document.getElementById('stat-note');if(n&&r.last_synced&&r.sync_complete){var p=r.last_synced.split('-');n.innerHTML=p[0]+'. '+parseInt(p[1])+'. '+parseInt(p[2])+'. 기준 국가법령정보센터 제공 법령·행정규칙·조약 등 99.9%+ 수록 <span style="white-space:nowrap">(매주 토요일 갱신)</span>';}
var keys=['헌법','법률','대통령령','총리령·부령','국회 등 헌법기관 규칙','행정규칙','조약','조례'];keys.forEach(function(k,i){var el=document.getElementById('sv-'+i);if(el&&r[k])el.textContent=Number(r[k]).toLocaleString('ko-KR');});
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

워크플로우:
1. law.find로 법령 식별 (법령명 모르면 search.keyword 먼저, 0건이면 suggested_laws 확인)
2. law.explore로 종합 탐색 (top_articles, top_cases 확인 — 다음 호출 가이드)
3. law.article로 핵심 조문 조회 (law 파라미터는 반드시 law_id 숫자)
4. 필요시 case.search/bill.search로 판례/의안 보충
종합 리서치가 필요하면 law.research(1회 호출로 법령+조문+판례+인용 통합), 개정 추적은 law.amendment, 분쟁 준비는 case.analysis를 사용하세요.
답변에 조문번호나 판례번호를 인용할 때는 반드시 law.verify 또는 case.verify로 실재 여부를 검증하세요 (환각 방지).

명령어 (command 필드에 입력):
- law.find: 법령 찾기. params: {q: "민법", exact?: true, active_only?: true, law_type?: "법률", limit?: 5}. 결과의 law_id로 다른 명령 호출.
- law.explore: 종합 탐색. 개별 호출 전에 먼저 사용. params: {law_id: "001706"}
- law.article: 조문 상세 (항/호/목 포함). params: {law_id: "001706", label: "제750조"} (law_id는 반드시 숫자. 법령명 불가. law.find로 먼저 확인). 범위 조회: {law_id, from_label: "제11조", to_label: "제14조"}
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
- search.regions: 시도별 조례 건수 조회. params: {sido?: "서울특별시"} (sido 없으면 전체 시도)
- search.local-ordinance: 자치법규(조례) 검색. params: {q: "주차장", sido?: "서울특별시", sigungu?: "용산구"}
- search.treaty: 조약 검색. params: {q: "..."}
- ref.doc: 참고문서 검색. params: {q: "법령입안심사기준"}
- help.schema: API 전체 스키마. params: {}
- help.stats: DB 현황. params: {}
- law.research: 종합 리서치 (1회 호출로 법령+조문+판례+인용 통합). params: {q: "개인정보보호법"}
- law.amendment: 개정 이력 추적. params: {q: "민법"}. 개정 연혁+신구대조+관련 의안 통합.
- case.analysis: 분쟁 준비 자료. params: {q: "부당해고"}. 판례+조문+관련 법령 통합.
- sendFeedback: 피드백 (2단계). 1차: params: {message} → ticket_id 발급 + 사용자에게 보여줄 내용 반환. 사용자에게 보여주고 동의 받기. 2차: params: {message, ticket_id} → 저장. ticket_id 없이는 저장 안 됨.

공통 파라미터:
- include=history,cases,xref,bills,timeline (추가 데이터 병합)
- count=true (본문 없이 건수만 반환)
URL path/query에 한글이나 공백이 포함되면 반드시 percent-encode 하세요.
unit_level: JO=조, HANG=항, HO=호, MOK=목. JO content가 제목만이면 has_children=true — 본문은 같은 응답의 HANG 레벨에 있음.
law_id는 6자리 숫자 (예: 001706=민법, 001692=형법)
주의: 이 API는 법제처+국회 공개 데이터만 수록. 금융위·거래소·공정위 고시, 각 부처 가이드라인, 자율규제 문서는 미수록. 검색 결과가 없더라도 해당 규범이 존재하지 않는다고 답하지 마세요.
주의: law.article의 law/law_id 파라미터는 반드시 6자리 숫자 ID. 법령명(예: "민법")을 넣으면 에러. law.find로 법령명 → law_id 변환 필수.`,
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
      const originData = await fetchOriginNormalized(originUrl, 'beopmang-mcp/1.0', command, env);
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
              const includeData = await fetchOriginNormalized(includeUrl, 'beopmang-mcp/1.0', includeCommand, env);
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
