# v0.2.0 릴리즈 노트

## 🎉 주요 변경사항

### ✅ 자동 답글 기능 완성
- `@디시봇 <질문>` 트리거 감지 → AI 답변 생성 → 답글 자동 삽입/등록
- `autoReply` + `autoSubmit` 기본 활성화

### 🐛 버그 수정
- **Thenable Proxy 이슈 해결**: `@webext-core/proxy-service`의 프록시가 thenable이라 `await`시 무한 대기하던 문제 수정
  - `getDcbotService()`를 동기 함수로 변경
  - `stripThenable()` 래퍼로 `.then` 프로퍼티 차단

### 🆕 새 기능
- `onlyMyTrigger`: 내 댓글에서만 트리거 허용 (기본값: true)
- 답변 길이 제한: 400자 (디시 댓글 제한 대응)
- 이미 답글이 달린 트리거는 재실행 방지

### 📁 DCInside DOM 어댑터 개선
- 답글 컨테이너 탐색 로직 개선 (`#cmt_write_box`, `#reply_list_*`)
- MutationObserver를 comment root에 바인딩하여 성능 개선

### 📄 기타
- 후원 버튼 추가 (ctee.kr)
- 상업적 이용 불가 라이선스 추가

---

## 📦 설치

1. [Releases](https://github.com/Stankjedi/dcbot/releases/tag/v0.2.0)에서 `dcbot-0.2.0-chrome.zip` 다운로드
2. Chrome `chrome://extensions` → 개발자 모드 → 압축해제된 확장 프로그램 로드
3. 옵션에서 API 설정 (Gemini API Key 등)

---

## ⚙️ 옵션 설정

| 설정 | 기본값 | 설명 |
|------|--------|------|
| `autoReply` | ✅ | 트리거 감지 시 자동 답변 생성 |
| `autoSubmit` | ✅ | 답변 생성 후 자동 등록 |
| `onlyMyTrigger` | ✅ | 내 댓글에서만 트리거 허용 |
| `maxAnswerChars` | 400 | 답변 최대 길이 |
