# DCBot 자동 답글 기능 디버깅 보고서

## 📋 현재 상태

**증상**: `@디시봇 응답하라` 댓글에서 "생성 중..."이 표시되고 멈춤. 실제 AI 답변이 생성되지 않음.

**API 테스트**: 옵션 페이지에서 "API 테스트" 버튼 클릭 시 **"성공: Gemini API 사용 가능"** 표시됨.

---

## 🔍 진단 과정

### 1단계: 콘솔 로그 분석

디버그 로그를 추가하여 확인한 결과:

```
[DCBot] handleGenerate 시작: {commentId: '3746661', ...}
[DCBot] 질문 추출 완료: {question: '응답하라', ...}
[DCBot] 백그라운드 서비스 호출 시작...
[DCBot RPC] ensureProxyService 시작...
[DCBot RPC] ensureProxyService 완료, getServiceFn 호출...
[DCBot RPC] 서비스 프록시 획득 완료
← 여기서 멈춤 (다음 로그가 안 나옴)
```

### 2단계: 백그라운드 서비스 확인

- `chrome://extensions` → 서비스 워커 콘솔 확인
- **결과**: `DCInside 디시봇 background ready` 정상 출력 ✅
- 백그라운드 스크립트는 정상적으로 로드됨

### 3단계: Content Script ↔ 백그라운드 통신 문제 확인

`getDcbotService()` 함수 내부에서 `return svc;` 이후에도 다음 로그가 출력되지 않음.

---

## 🔴 발견된 문제

### 문제: `@webext-core/proxy-service`의 Thenable Proxy 이슈

**원인 분석:**

`@webext-core/proxy-service`의 `getService()` 함수가 반환하는 프록시 객체가 **thenable** (`.then()` 메서드를 가진 객체)입니다.

JavaScript의 `async/await` 동작 특성:
- `await` 키워드는 값이 **thenable**인지 확인
- thenable이면 `.then()`을 호출하고 결과를 기다림
- 프록시가 `.then()`을 가로채서 RPC 호출로 변환 → **무한 대기**

**코드 흐름:**
```typescript
// getDcbotService() 내부
const svc = getServiceFn!();  // 프록시 객체 반환
return svc;  // async 함수라서 암묵적으로 await처럼 동작

// content script에서
const svc = await getDcbotService();  // thenable 확인 → .then() 호출 → 무한 대기
```

---

## 🛠️ 시도한 해결 방법

### 시도 1: `Promise.resolve()` 래핑

```typescript
// 수정 전
return svc;

// 수정 후
return Promise.resolve(svc);
```

**이론**: `Promise.resolve()`로 감싸면 이미 resolved된 Promise가 되어 thenable 체크를 우회할 수 있음.

**결과**: ❌ 실패

`Promise.resolve(thenable)` / `await thenable` 모두 **thenable 동화(assimilation)** 과정에서 `.then()`을 호출합니다.  
즉, 프록시의 `then` 접근이 RPC로 변환되면서 **무한 대기**가 그대로 발생합니다.

---

## ✅ 최종 해결

### 해결 1: `getDcbotService()`를 **동기 함수로** 만들고 `await` 금지

핵심은 **thenable 프록시를 Promise/await 경로로 보내지 않는 것**입니다.

- `getDcbotService()`는 `async`가 아니어야 함 (Promise로 감싸지지 않게)
- 호출부는 `const svc = getDcbotService()` 처럼 **await 없이** 사용

> 적용 후, 기존에 찍히던 `[DCBot RPC] ensureProxyService ...` 로그가 더 이상 나오지 않아야 합니다.

### (중요) 빌드/리로드 체크리스트

소스 수정 후에도 브라우저에서 로그가 그대로면, **확장이 구버전 빌드(.output)** 를 로드 중인 상태입니다.

1. `pnpm dev` 또는 `pnpm build`로 다시 빌드
2. Chrome `chrome://extensions` → 해당 확장 **리로드**
3. 디시 페이지 **하드 새로고침(Ctrl+F5)**

> WSL(`/mnt/c/...`)에서 작업 중인데 `pnpm build/dev`가 Rollup/esbuild 플랫폼 바이너리 오류로 실패하면, `node_modules`가 Windows용으로 설치된 상태일 수 있습니다. 이 경우 **WSL에서 `pnpm install`을 다시** 실행해 Linux용 의존성으로 재구성해야 합니다.

---

## 📁 수정된 파일

| 파일 | 변경 내용 |
|------|-----------|
| `src/lib/rpc/dcbot.ts` | `getDcbotService()`에서 `Promise.resolve(svc)` 반환 |
| `src/lib/adapter/dcinsideAdapter.ts` | DCInside DOM 셀렉터 수정 (`.btn_reply_write_all`, `.repley_add`, `li.ub-content`) |
| `src/entrypoints/dcinside.content.ts` | 디버그 로그 추가, `autoSubmit` 시 자동 삽입 로직 추가 |
| `src/entrypoints/popup/App.tsx` | Provider 상태, 에러 로그 표시 개선 |
| `src/lib/storage/settings.ts` | `autoReply`, `autoSubmit` 기본값 `true`로 변경 |

---

## 🔜 다음 단계

1. **시도 1 테스트**: `Promise.resolve()` 래핑이 작동하는지 확인
2. **대안 A**: 프록시 객체를 직접 반환하지 않고, 래퍼 객체 생성
3. **대안 B**: `@webext-core/proxy-service` 대신 직접 `browser.runtime.sendMessage` 사용
4. **대안 C**: 라이브러리 버전 업그레이드 또는 다운그레이드

---

## 📊 환경 정보

- **Chrome Extension**: MV3
- **Framework**: WXT 0.20.6
- **RPC Library**: `@webext-core/proxy-service` 1.2.2
- **Provider Mode**: `google_gemini`
- **API Key**: 설정됨 (테스트 성공)

---

*마지막 업데이트: 2024-12-30 17:42*
