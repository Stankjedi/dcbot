# DCInside 디시봇 (Chrome Extension, MV3)

[![Support](https://img.shields.io/badge/☕_후원하기-ctee.kr-orange?style=for-the-badge)](https://ctee.kr/place/stankjedi)
[![License](https://img.shields.io/badge/License-Non--Commercial-red?style=for-the-badge)](./LICENSE)

디시인사이드 게시글 페이지에서 **내 댓글**의 `@디시봇` 트리거를 감지해 답변을 생성하고, **답글(하위댓글) 입력창에 자동 삽입(선택: 자동 등록)** 까지 도와주는 크롬 확장입니다.

- 기본값: **내 댓글에서만 트리거 허용**, **답변 120자 제한(최대 400)**, **이미 답글이 달린 트리거는 재실행 방지**
- 지원: `https://gall.dcinside.com/*`, `https://m.dcinside.com/*`

> 주의: 이 프로젝트는 DCInside와 무관한 개인 프로젝트입니다. 사용 시 사이트 정책/법령을 준수하세요.

## 주요 기능

- 트리거: `@디시봇 <질문>`
- 답변 생성: `google_gemini` / `openai_direct` / `local_proxy`(권장)
- 프롬프트 최소화: QA 답변은 **질문만 전달**(글/댓글/갤 검색 컨텍스트 미전송)
- 검색(옵션): `@디시봇 검색:` 명령으로 갤러리 내부 검색(제목만 출력, URL 미포함)
- 답글 입력 방식 대응: 댓글을 클릭/답글쓰기 영역을 눌러 **답글창이 생성되는 구조**에 맞춰 textarea를 찾아 입력
- 자동등록방지 감지: “자동등록방지”가 보이면 자동 등록 클릭을 중단
- 길이 제한: 디시 댓글 입력 제한 때문에 **항상 400자 이하**로 잘라서 삽입

## 보안/개인정보

- 이 레포/문서에 **API Key/토큰을 절대 커밋하지 마세요.**
- `google_gemini` / `openai_direct`는 키를 브라우저(확장)에 저장합니다(BYOK). 개인용으로만 권장합니다.
- 키를 브라우저에 저장하지 않으려면 `local_proxy` 모드를 사용하세요(키는 로컬 서버 환경변수로 보관).

## 설치 (Unpacked / 개발자 모드)

### 요구사항

- Node.js 18+
- pnpm
- Chrome/Chromium (MV3)

### 빌드 & 로드

```bash
pnpm install
pnpm build
```

1. Chrome에서 `chrome://extensions` 접속
2. “개발자 모드” ON
3. “압축해제된 확장 프로그램을 로드” 클릭
4. 이 프로젝트의 `.output/chrome-mv3` 폴더 선택

## 옵션 설정

확장 아이콘 → “옵션 열기”에서 설정합니다.

### 공통 설정(중요)

- **내 댓글에서만 트리거 허용 (권장)**: 기본 ON  
  다른 사람이 `@디시봇`을 댓글에 써도 작동하지 않게 막습니다.
- **갤러리 검색 대상**: 기본 `thesingularity`(마이너갤)  
  `@디시봇 검색:`에서 사용할 갤러리 ID/종류입니다. 다른 갤에서 쓰면 여기 값을 바꾸세요.
- **최대 답변 글자수**: 기본 120, 최대 400 (디시 제한)
- **자동 답변 생성**: 기본 ON  
  트리거를 감지하면 즉시 답변 생성을 시작합니다(OFF면 `답변 생성` 버튼을 눌러야 함).
- **자동 등록(위험)**: 기본 ON  
  ON이면 생성 후 답글창에 넣고, 캡차가 없을 때만 “등록”까지 클릭합니다. (캡차가 보이면 자동 등록 중단)

### Provider Mode

#### A) `google_gemini` (Gemini API, BYOK)

1. Provider Mode: `google_gemini`
2. “브라우저 키 저장 허용”을 켜고 Google API Key 입력
3. Model 예시: `gemini-2.0-flash`
4. “API 테스트”로 권한/연결 확인

#### B) `openai_direct` (OpenAI 호환 API, BYOK)

1. Provider Mode: `openai_direct`
2. Direct API Base URL 설정 (예: `https://api.openai.com/v1`)
3. Direct API Type: `auto` 권장
4. “브라우저 키 저장 허용”을 켜고 API Key 입력
5. “API 테스트”로 권한/연결 확인

#### C) `local_proxy` (권장: 키를 브라우저에 저장하지 않음)

1. Provider Mode: `local_proxy`
2. `Local Proxy URL` 입력 (기본: `http://127.0.0.1:8787`)
3. `Local Proxy Token` 입력 (서버의 `DCBOT_PROXY_TOKEN`과 동일)
4. “Test local proxy”로 연결/인증 확인

## 사용법 (디시에서)

1. 디시 게시글 페이지에서 **내가 쓴 댓글**에 트리거로 질문을 적습니다.
   - 예: `@디시봇 1 더하기 1이 뭐야?`
2. 댓글에 작은 UI가 붙습니다.
   - 자동 답변 생성 ON: 바로 생성 시작
   - 자동 답변 생성 OFF: `답변 생성` 클릭
3. 설정에 따라 동작합니다.
   - 자동 등록 OFF: 미리보기 확인 → `삽입` 클릭
   - 자동 등록 ON: 자동으로 답글창에 넣고(캡차가 없으면) 등록 클릭까지 시도

### 명령어

- `@디시봇 help` : 사용법 출력
- `@디시봇 검색: 키워드` : 내부 검색 결과 제목만 출력
- `@디시봇 요약` / `@디시봇 summary` : 현재 글 요약(가능한 경우)
- `@디시봇 설정` : 옵션 열기 안내

## 로컬 프록시 서버 (레포 포함)

템플릿 서버: `server/index.mjs` (Node 내장 `http`, 의존성 없음)

### 1) 환경변수 준비

```bash
cp server/.env.example server/.env
# server/.env에 아래를 채우세요.
# - DCBOT_PROXY_TOKEN (필수)
# - DCBOT_LLM_PROVIDER=openai|gemini
# - OPENAI_API_KEY 또는 GEMINI_API_KEY
set -a && source server/.env && set +a
```

### 2) 실행

```bash
node server/index.mjs
curl http://127.0.0.1:8787/health
```

### 3) 확장 옵션 연결

- Provider Mode: `local_proxy`
- Local Proxy URL: `http://127.0.0.1:8787` (끝에 `/api/answer`를 붙이지 않음)
- Local Proxy Token: `DCBOT_PROXY_TOKEN`과 동일
- (선택) `DCBOT_ALLOWED_ORIGINS`: `chrome-extension://<확장ID>` 형태로 CORS를 더 좁게 제한 가능

## 빌드/배포

```bash
pnpm build
pnpm zip
```

- `.output/chrome-mv3` : 압축해제 로드용
- `pnpm zip` : 배포용 zip 생성 (Chrome Web Store 업로드 등)

## 트러블슈팅

- **“Extension context invalidated”**
  - 확장 리로드 후, 디시 탭을 새로고침(Ctrl+F5)하면 대부분 해결됩니다.
- **답글 입력창/등록 버튼을 못 찾음**
  - 디시 스킨/모바일/레이아웃에 따라 DOM이 달라질 수 있습니다.
  - 옵션에서 `debug`를 켠 뒤, 오류 메시지의 진단 문자열을 바탕으로 셀렉터를 보강하세요.
- **자동등록방지(캡차)**
  - 자동 등록은 하지 않습니다(의도된 동작). 답글창에 내용이 들어가면 직접 캡차 입력 후 등록하세요.

## 개발/테스트

```bash
pnpm dev
pnpm test
```

## 프롬프트(말투) 커스터마이징

- 간단 커스터마이징: 옵션의 `인스트럭션(QA)`에서 “추가 지침”을 수정
- 고급 커스터마이징:
  - QA 답변 프롬프트: `src/lib/llm/prompt.ts`
  - 요약 프롬프트: `src/lib/llm/prompt.ts`
