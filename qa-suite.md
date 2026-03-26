# 법망 API QA Suite

수정 후 반드시 이 전체를 돌려서 regression 없는지 확인.
`bash ~/shared/bin/hn-qa.sh sp "$(cat ~/beopmang-api/qa-suite.md)"` 로 실행.

## A. 에이전트 진입점 (5건)

A1. GET / (JSON 기본): curl -s https://api.beopmang.org/
→ api_version=v3, IMPORTANT 필드 존재, endpoints에 /api/v3/* 7개

A2. GET / (HTML): curl -s -H 'Accept: text/html' https://api.beopmang.org/
→ HTML 반환, hidden div#agent-guide 존재, api/v3 언급

A3. agent.json: curl -s https://api.beopmang.org/.well-known/agent.json
→ api_version=v3, endpoints 7개, workflow 존재

A4. MCP initialize + tools/list:
curl -s -X POST https://api.beopmang.org/mcp -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"qa"}}}'
curl -s -X POST https://api.beopmang.org/mcp -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
→ 도구명 '법망', description에 '반드시 여러 번 호출' + 'law.find' + 'percent-encode' + 'law.verify' 포함

A5. help.schema: curl -s 'https://api.beopmang.org/api/v3/help?action=schema'
→ data.version=3, endpoints 존재

## B. v3 law (8건)

B1. law find: curl -s 'https://api.beopmang.org/api/v3/law?action=find&q=%EB%AF%BC%EB%B2%95' → data 배열, 첫 항목 law_id=001706
B2. law explore: curl -s 'https://api.beopmang.org/api/v3/law?action=explore&law_id=001706' → data.law_name=민법
B3. law article: curl -s 'https://api.beopmang.org/api/v3/law?action=article&law_id=001706&label=%EC%A0%9C750%EC%A1%B0' → 제750조 포함
B4. law detail: curl -s 'https://api.beopmang.org/api/v3/law?action=detail&law_id=001706' → data 존재
B5. law history: curl -s 'https://api.beopmang.org/api/v3/law?action=history&law_id=001706' → data 배열
B6. law diff: curl -s 'https://api.beopmang.org/api/v3/law?action=diff&law_id=001706' → data.diff 존재
B7. law verify (존재): curl -s 'https://api.beopmang.org/api/v3/law?action=verify&q=%EB%AF%BC%EB%B2%95%20%EC%A0%9C750%EC%A1%B0' → exists:true, article_exists:true
B8. law verify (미존재): curl -s 'https://api.beopmang.org/api/v3/law?action=verify&q=%EB%AF%BC%EB%B2%95%20%EC%A0%9C9999%EC%A1%B0' → article_exists:false

## C. v3 case (5건)

C1. case search: curl -s 'https://api.beopmang.org/api/v3/case?action=search&q=%EC%9E%84%EB%8C%80%EC%B0%A8' → data 배열
C2. case by-law: curl -s 'https://api.beopmang.org/api/v3/case?action=by-law&law_id=001706' --max-time 25 → data 배열
C3. case hsearch: curl -s 'https://api.beopmang.org/api/v3/case?action=hsearch&q=%EC%9E%84%EB%8C%80%EC%B0%A8' --max-time 30 → data 배열 (타임아웃 가능)
C4. case verify (존재): curl -s 'https://api.beopmang.org/api/v3/case?action=verify&q=2017%EB%91%9047045' → exists:true
C5. case verify (미존재): curl -s 'https://api.beopmang.org/api/v3/case?action=verify&q=9999%EB%91%9099999' → exists:false

## D. v3 bill (2건)

D1. bill search: curl -s 'https://api.beopmang.org/api/v3/bill?action=search&q=%ED%98%95%EB%B2%95' → data 배열
D2. bill detail: curl -s 'https://api.beopmang.org/api/v3/bill?action=detail&bill_id=PRC_L2K6Q0Q3O1V8T1S0S1A7Z4Y5W0U4A3' → data 존재

## E. v3 graph (3건)

E1. graph xref: curl -s 'https://api.beopmang.org/api/v3/graph?action=xref&law_id=001706' → data 배열
E2. graph timeline: curl -s 'https://api.beopmang.org/api/v3/graph?action=timeline&law_id=001706' → data 배열
E3. graph neighbors: curl -s 'https://api.beopmang.org/api/v3/graph?action=neighbors&law_id=001706' → data 존재 (빈 배열 가능)

## F. v3 search (4건)

F1. search keyword: curl -s 'https://api.beopmang.org/api/v3/search?action=keyword&q=%ED%99%94%ED%95%99%EB%AC%BC%EC%A7%88' → data 배열
F2. search semantic: curl -s 'https://api.beopmang.org/api/v3/search?action=semantic&q=%ED%99%94%ED%95%99%EB%AC%BC%EC%A7%88' → data 배열
F3. search ordinance: curl -s 'https://api.beopmang.org/api/v3/search?action=ordinance&q=%EC%A3%BC%EC%B0%A8%EC%9E%A5' → data 배열
F4. search treaty: curl -s 'https://api.beopmang.org/api/v3/search?action=treaty&q=%ED%8C%8C%EB%A6%AC' → data 배열

## G. v3 기타 (3건)

G1. ref doc: curl -s 'https://api.beopmang.org/api/v3/ref?action=doc&q=%EB%B2%95%EB%A0%B9%EC%9E%85%EC%95%88' → data 배열
G2. help stats: curl -s 'https://api.beopmang.org/api/v3/help?action=stats' → data에 법률/판례 숫자
G3. count=true: curl -s 'https://api.beopmang.org/api/v3/law?action=find&q=%EB%AF%BC%EB%B2%95&count=true' → data:null, meta.count 존재

## H. MCP v3 명령 (5건)

H1. MCP law.find: curl -s -X POST https://api.beopmang.org/mcp -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":10,"method":"tools/call","params":{"name":"법망","arguments":{"command":"law.find","params":{"q":"민법"}}}}' → 결과에 001706
H2. MCP law.explore: command=law.explore, params={law_id:"001706"} → 민법 데이터
H3. MCP law.verify: command=law.verify, params={q:"민법 제750조"} → exists:true
H4. MCP case.verify: command=case.verify, params={q:"2017두47045"} → exists:true
H5. MCP sendFeedback: command=sendFeedback, params={message:"QA regression"} → Feedback received

## I. 에러 핸들링 (6건)

I1. 잘못된 엔드포인트: curl -s 'https://api.beopmang.org/api/v3/foo?action=bar' → error.message에 Unknown endpoint
I2. 잘못된 action: curl -s 'https://api.beopmang.org/api/v3/law?action=foo' → error.message에 Unknown action
I3. 빈 쿼리: curl -s 'https://api.beopmang.org/api/v3/law?action=verify&q=' → error 반환
I4. MCP 잘못된 tool name: {"method":"tools/call","params":{"name":"wrong","arguments":{"command":"law.find"}}} → error_type=invalid_tool_name, canonical_name=법망
I5. MCP 잘못된 command: {"method":"tools/call","params":{"name":"법망","arguments":{"command":"없는거"}}} → error_type=unknown_command
I6. MCP command 누락: {"method":"tools/call","params":{"name":"법망","arguments":{}}} → error_type=missing_command

## J. v1 하위호환 (5건)

J1. find: curl -s 'https://api.beopmang.org/find?q=%EB%AF%BC%EB%B2%95' → 200, law_id=001706
J2. law: curl -s 'https://api.beopmang.org/law/001706' → 200
J3. article: curl -s 'https://api.beopmang.org/article/001706/%EC%A0%9C750%EC%A1%B0' → 200
J4. health: curl -s https://api.beopmang.org/health → status=ok
J5. include: curl -s 'https://api.beopmang.org/find?q=%EB%AF%BC%EB%B2%95&include=history,cases' → included 객체에 history, cases

## K. MCP legacy fallback (2건)

K1. findLaw: curl -s -X POST https://api.beopmang.org/mcp -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":20,"method":"tools/call","params":{"name":"법망","arguments":{"command":"findLaw","params":{"query":"민법"}}}}' → 결과에 001706
K2. exploreLaw: command=exploreLaw, params={law_id:"001706"} → 민법

## L. 피드백 (2건)

L1. REST: curl -s -X POST https://api.beopmang.org/feedback -H 'Content-Type: application/json' -d '{"message":"QA regression test"}' → ok:true
L2. MCP: sendFeedback → Feedback received

---
총 50건. 모든 curl에 --max-time 25 (hsearch만 30). 결과를 results.md에 OK/FAIL 테이블로 정리.
