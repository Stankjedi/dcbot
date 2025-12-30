import type { CommentNode } from '@/lib/adapter/types';

export default defineContentScript({
  matches: ['https://gall.dcinside.com/*', 'https://m.dcinside.com/*'],
  runAt: 'document_idle',
  async main() {
    try {
      console.log('[DCBot] content loaded', { id: browser.runtime.id, version: browser.runtime.getManifest().version });
    } catch {
      // ignore
    }
    const [{ createDcinsideAdapter }, { getSettings }, { getHandledCommentMap, setLastSeenGallery }, { getDcbotService }, { pickContextWindow }] =
      await Promise.all([
        import('@/lib/adapter/dcinsideAdapter'),
        import('@/lib/storage/settings'),
        import('@/lib/storage/localState'),
        import('@/lib/rpc/dcbot'),
        import('@/lib/util/context'),
      ]);

    let settings = await getSettings();
    const adapter = createDcinsideAdapter({ getDebug: () => settings.debug });

    const pageGallery = (() => {
      try {
        const u = new URL(location.href);
        const id = (u.searchParams.get('id') ?? '').trim();
        const isMgallery = u.pathname.includes('/mgallery/');
        return id ? { galleryId: id, isMgallery } : null;
      } catch {
        return null;
      }
    })();

    if (pageGallery) {
      void setLastSeenGallery(pageGallery.galleryId, pageGallery.isMgallery);
    }

    const handled = new Set<string>(Object.keys(await getHandledCommentMap()));
    const processing = new Set<string>();
    const scanTimestamps: number[] = [];
    let scanTimer: number | null = null;
    const pendingCommentEls = new Set<HTMLElement>();
    let needsFullScan = true;
    let lastFullScanAt = 0;
    let fullScanState: { root: Element; nodes: CommentNode[]; index: number } | null = null;
    let lastDebugStatsAt = 0;
    let observer: MutationObserver | null = null;
    let observerMode: 'document' | 'comments' = 'document';
    let observedRoot: Element | null = null;
    let noRootBackoffMs = 500;
    let noRootUntil = 0;

    const COMMENT_CONTAINER_SELECTOR = [
      'li[id^="comment_"]',
      'li[id^="cmt_"]',
      'li[data-no]',
      'li[data-comment-no]',
      'li.reply',
      'li.comment',
      'tr[data-no]',
      'tr[data-comment-no]',
      'div[data-no]',
      'div[data-comment-no]',
    ].join(',');

    function getScanBudget() {
      return settings.debug
        ? {
          maxNodes: 600,
          maxMs: 16,
          maxEnqueueFromMutations: 400,
          maxPending: 1200,
          fullScanIntervalMs: 30_000,
        }
        : {
          maxNodes: 450,
          maxMs: 12,
          maxEnqueueFromMutations: 160,
          maxPending: 800,
          fullScanIntervalMs: 0,
        };
    }

    function toUserMessage(error: unknown) {
      const raw =
        error instanceof Error
          ? error.message
          : typeof error === 'object' && error != null && 'message' in error
            ? String((error as any).message)
            : String(error);
      return raw.replace(/^Error:\s*/i, '').trim();
    }

    function ensureStyles() {
      if (document.getElementById('dcbot-style')) return;
      const style = document.createElement('style');
      style.id = 'dcbot-style';
      style.textContent = `
        .dcbot-ui{margin-top:6px;padding:6px 8px;border:1px solid rgba(0,0,0,.08);border-radius:8px;background:rgba(0,0,0,.02);font-size:12px;line-height:1.4}
        .dcbot-ui__row{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
        .dcbot-ui__btn{border:1px solid rgba(0,0,0,.18);background:#fff;border-radius:6px;padding:4px 8px;cursor:pointer}
        .dcbot-ui__btn[disabled]{opacity:.5;cursor:not-allowed}
        .dcbot-ui__status{color:#666}
        .dcbot-ui__preview{margin:6px 0 0;white-space:pre-wrap;background:#fff;border:1px solid rgba(0,0,0,.08);border-radius:6px;padding:6px;max-height:220px;overflow:auto}
      `;
      document.documentElement.appendChild(style);
    }

    function isLikelyMyTriggerComment(nodeEl: HTMLElement): boolean {
      // Prefer cheap, local signals: edit/delete actions exist only on "my" comments in most DCInside layouts.
      for (const el of Array.from(nodeEl.querySelectorAll<HTMLElement>('a,button'))) {
        const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (text === '삭제' || text === '수정' || text === '삭제하기' || text === '수정하기') return true;

        const aria = (el.getAttribute('aria-label') ?? '').trim();
        const title = (el.getAttribute('title') ?? '').trim();
        if (aria === '삭제' || aria === '수정' || title === '삭제' || title === '수정') return true;

        const cls = `${el.className} ${el.id}`.toLowerCase();
        if ((cls.includes('del') || cls.includes('delete') || cls.includes('remove')) && (cls.includes('cmt') || cls.includes('comment') || cls.includes('reply') || cls.includes('reple'))) {
          return true;
        }
        if ((cls.includes('modify') || cls.includes('edit')) && (cls.includes('cmt') || cls.includes('comment') || cls.includes('reply') || cls.includes('reple'))) {
          return true;
        }
      }

      // Some pages store actions in onclick handlers.
      for (const el of Array.from(nodeEl.querySelectorAll<HTMLElement>('[onclick]'))) {
        const onclick = (el.getAttribute('onclick') ?? '').toLowerCase();
        if ((onclick.includes('del') || onclick.includes('delete') || onclick.includes('remove')) && (onclick.includes('comment') || onclick.includes('cmt') || onclick.includes('reply') || onclick.includes('reple'))) {
          return true;
        }
        if ((onclick.includes('modify') || onclick.includes('edit')) && (onclick.includes('comment') || onclick.includes('cmt') || onclick.includes('reply') || onclick.includes('reple'))) {
          return true;
        }
      }

      // Fallback: minimal class/dataset hints.
      const cls = nodeEl.className.toLowerCase();
      if (/\b(my|mine|owner)\b/i.test(cls) && (cls.includes('comment') || cls.includes('cmt') || cls.includes('reply') || cls.includes('reple'))) {
        return true;
      }
      const dataset = (nodeEl.dataset ?? {}) as Record<string, string | undefined>;
      const flag = (v: string | undefined) => v === '1' || v === 'true';
      if (flag(dataset.my) || flag(dataset.mine) || flag(dataset.owner)) return true;

      return false;
    }

    function isNumericId(id: string) {
      return /^\d+$/.test(id);
    }

    function findReplyListForComment(nodeEl: HTMLElement, commentId: string): HTMLElement | null {
      if (!isNumericId(commentId)) return null;

      const direct = document.getElementById(`reply_list_${commentId}`);
      if (direct instanceof HTMLElement) return direct;

      // Some layouts keep reply_list inside a nearby wrapper inserted after the comment.
      let sib: Element | null = nodeEl.nextElementSibling;
      for (let i = 0; i < 10 && sib; i++) {
        if (sib instanceof HTMLElement) {
          const found = sib.querySelector<HTMLElement>(`#reply_list_${CSS.escape(commentId)}`);
          if (found) return found;
        }
        sib = sib.nextElementSibling;
      }

      // Fallback: look for a reply_list with matching parent-no attribute.
      const byAttr = document.querySelector<HTMLElement>(`ul.reply_list[p-no="${CSS.escape(commentId)}"]`);
      return byAttr ?? null;
    }

    function hasExistingMyReply(nodeEl: HTMLElement, commentId: string): boolean {
      const list = findReplyListForComment(nodeEl, commentId);
      if (!list) return false;

      // DCInside comment.js tags ownership on delete/modify container: .cmt_mdf_del[data-my="Y"]
      const ownFlag = list.querySelector<HTMLElement>('.cmt_mdf_del[data-my="Y"], .cmt_mdf_del[data-my="y"]');
      if (ownFlag) return true;

      // Heuristic fallback: detect delete/edit actions within reply items.
      const items = Array.from(list.querySelectorAll<HTMLElement>('li.ub-content, li[id^="reply_li_"], li')).slice(0, 120);
      for (const item of items) {
        if (isLikelyMyTriggerComment(item)) return true;
      }

      return false;
    }

    function getPostContext() {
      const title =
        document.querySelector('h3.title')?.textContent?.trim() ||
        document.querySelector('.title_headtext')?.textContent?.trim() ||
        document.querySelector('.gallview_head .title')?.textContent?.trim() ||
        '';

      const body =
        document.querySelector('.write_div')?.textContent?.trim() ||
        document.querySelector('.writing_view_box')?.textContent?.trim() ||
        '';

      const clippedBody = body.length > 0 ? body.slice(0, 800) : '';
      return { title: title || undefined, bodyText: clippedBody || undefined };
    }

    function buildHelpText(trigger: string) {
      return [
        `사용법: ${trigger} <질문>`,
        `예시: ${trigger} 1 더하기 1이 뭐야?`,
        `명령: ${trigger} help / ${trigger} 검색:키워드 / ${trigger} 요약:이 글 / ${trigger} 설정`,
      ].join('\n');
    }

    function clampAnswer(text: string) {
      const max = settings.maxAnswerChars;
      const cleaned = text.trim();
      if (max <= 0) return cleaned;
      if (cleaned.length <= max) return cleaned;
      return `${cleaned.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
    }

    function getRecentCommentsContext(nodeEl: HTMLElement, maxItems = 8): string[] | undefined {
      const limit = Math.max(0, Math.trunc(maxItems));
      if (limit === 0) return undefined;

      // Avoid expensive full-root scans here; this runs on every generation.
      // Instead, collect a small window from nearby siblings.
      const before: string[] = [];
      const after: string[] = [];

      const normalize = (t: string) =>
        t
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 240);

      let cur: Element | null = nodeEl;
      while (before.length < limit && (cur = cur.previousElementSibling)) {
        if (!(cur instanceof HTMLElement)) continue;
        if (!cur.matches(COMMENT_CONTAINER_SELECTOR)) continue;
        const text = normalize(adapter.getCommentText(adapter.makeCommentNode(cur)));
        if (!text) continue;
        before.push(text.length > 200 ? `${text.slice(0, 200).trimEnd()}…` : text);
      }

      cur = nodeEl;
      while (before.length + after.length < limit && (cur = cur.nextElementSibling)) {
        if (!(cur instanceof HTMLElement)) continue;
        if (!cur.matches(COMMENT_CONTAINER_SELECTOR)) continue;
        const text = normalize(adapter.getCommentText(adapter.makeCommentNode(cur)));
        if (!text) continue;
        after.push(text.length > 200 ? `${text.slice(0, 200).trimEnd()}…` : text);
      }

      const texts = [...before.reverse(), ...after];
      return texts.length > 0 ? texts : undefined;
    }

    async function handleGenerate(nodeEl: HTMLElement, commentId: string, commentText: string, ui: HTMLElement) {
      if (processing.has(commentId)) return;
      processing.add(commentId);

      const status = ui.querySelector<HTMLElement>('.dcbot-ui__status');
      const btnGen = ui.querySelector<HTMLButtonElement>('.dcbot-ui__btn--gen');
      const btnInsert = ui.querySelector<HTMLButtonElement>('.dcbot-ui__btn--insert');
      const preview = ui.querySelector<HTMLPreElement>('.dcbot-ui__preview');
      let op: 'help' | 'search' | 'settings' | 'summary' | 'qa' = 'qa';

      try {
        btnGen && (btnGen.disabled = true);
        btnInsert && (btnInsert.disabled = true);
        status && (status.textContent = '생성 중…');
        console.log('[DCBot] handleGenerate 시작:', { commentId, commentText: commentText.slice(0, 50) });

        const question = adapter.extractQuestion(commentText, settings.trigger);
        const { title, bodyText } = getPostContext();
        console.log('[DCBot] 질문 추출 완료:', { question: question.slice(0, 50), titleLen: title?.length, bodyLen: bodyText?.length });

        console.log('[DCBot] 백그라운드 서비스 호출 시작...');
        const svc = getDcbotService();
        console.log('[DCBot] 백그라운드 서비스 프록시 획득 완료, health 호출 테스트...');

        // 실제 RPC 통신 테스트
        try {
          const healthResult = await Promise.race([
            svc.health(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('RPC timeout (5초)')), 5000))
          ]);
          console.log('[DCBot] health 응답:', healthResult);
        } catch (healthErr) {
          console.error('[DCBot] health 호출 실패:', healthErr);
          throw new Error(`백그라운드 서비스 통신 실패: ${healthErr}`);
        }

        console.log('[DCBot] 백그라운드 서비스 연결 완료');

        // Command mode: help / search
        const qTrim = question.trim();
        if (!qTrim || /^help$/i.test(qTrim) || qTrim === '도움' || qTrim === '도움말') {
          op = 'help';
          const answer = clampAnswer(buildHelpText(settings.trigger));
          if (preview) {
            preview.textContent = answer;
            preview.style.display = '';
          }
          if (status) status.textContent = '완료';
          if (btnInsert) btnInsert.disabled = false;
          (ui as any)._dcbotAnswer = answer;
          if (settings.autoSubmit) {
            processing.delete(commentId);
            await handleInsert(nodeEl, commentId, ui);
          }
          return;
        }

        const SUMMARY_KO = '\uC694\uC57D';
        const summaryMatch =
          qTrim.match(/^summary\s*[:：]?\s*(.*)$/i) ||
          qTrim.match(new RegExp(`^${SUMMARY_KO}\\s*[:：]?\\s*(.*)$`));
        if (summaryMatch) {
          op = 'summary';
          const rest = (summaryMatch[1] ?? '').trim();
          const result = await svc.generateAnswer({
            commentId,
            question: rest,
            mode: 'summary',
            pageUrl: location.href,
            pageGalleryId: pageGallery?.galleryId,
            pageIsMgallery: pageGallery?.isMgallery,
            postTitle: title,
            postBodyText: bodyText,
            recentComments: undefined,
          });
          const answer = clampAnswer(result.answer);

          if (preview) {
            preview.textContent = answer;
            preview.style.display = '';
          }
          if (status) status.textContent = result.cached ? '완료(캐시)' : '완료';
          if (btnInsert) btnInsert.disabled = false;
          (ui as any)._dcbotAnswer = answer;
          if (settings.autoSubmit) {
            processing.delete(commentId);
            await handleInsert(nodeEl, commentId, ui);
          }
          return;
        }

        if (/^(검색|search)\s*:/i.test(qTrim)) {
          op = 'search';
          const keyword = qTrim.replace(/^(검색|search)\s*:/i, '').trim();
          const results = keyword ? await svc.dcSearch(keyword, settings.searchLimit) : [];
          const answer = clampAnswer(
            results.length === 0
              ? '검색 결과가 없어요.'
              : ['관련 글:', ...results.slice(0, Math.min(5, settings.searchLimit)).map((r, i) => `${i + 1}) ${r.title} - ${r.url}`)].join(
                '\n',
              ),
          );
          if (preview) {
            preview.textContent = answer;
            preview.style.display = '';
          }
          if (status) status.textContent = '완료';
          if (btnInsert) btnInsert.disabled = false;
          (ui as any)._dcbotAnswer = answer;
          if (settings.autoSubmit) {
            processing.delete(commentId);
            await handleInsert(nodeEl, commentId, ui);
          }
          return;
        }

        if (qTrim === '설정') {
          op = 'settings';
          const answer = clampAnswer('옵션: 확장 아이콘 클릭 → [옵션 열기]');
          if (preview) {
            preview.textContent = answer;
            preview.style.display = '';
          }
          if (status) status.textContent = '완료';
          if (btnInsert) btnInsert.disabled = false;
          (ui as any)._dcbotAnswer = answer;
          if (settings.autoSubmit) {
            processing.delete(commentId);
            await handleInsert(nodeEl, commentId, ui);
          }
          return;
        }

        op = 'qa';
        console.log('[DCBot] generateAnswer 호출 시작...', { commentId, question: qTrim.slice(0, 30) });
        const result = await svc.generateAnswer({
          commentId,
          question: qTrim,
          pageUrl: location.href,
          pageGalleryId: pageGallery?.galleryId,
          pageIsMgallery: pageGallery?.isMgallery,
          postTitle: title,
          postBodyText: bodyText,
          recentComments: getRecentCommentsContext(nodeEl),
        });
        console.log('[DCBot] generateAnswer 완료!', { answerLen: result.answer?.length, cached: result.cached });
        const answer = clampAnswer(result.answer);

        if (preview) {
          preview.textContent = answer;
          preview.style.display = '';
        }
        if (status) status.textContent = result.cached ? '완료(캐시)' : '완료';
        if (btnInsert) btnInsert.disabled = false;
        (ui as any)._dcbotAnswer = answer;

        // autoSubmit이면 자동으로 삽입까지 진행
        if (settings.autoSubmit) {
          processing.delete(commentId);
          await handleInsert(nodeEl, commentId, ui);
          return;
        }
      } catch (error) {
        const msg = toUserMessage(error);
        const isBlocked =
          msg.includes('쿨다운') ||
          msg.includes('요청이 너무 많') ||
          msg.includes('브라우저 키 저장 허용') ||
          msg.includes('openai_direct');
        if (status) status.textContent = isBlocked ? msg : `오류: ${msg}`;
        btnGen && (btnGen.disabled = false);

        const classify = (m: string) => {
          const lower = m.toLowerCase();
          if (m.includes('쿨다운') || m.includes('요청이 너무 많')) return 'blocked';
          if (lower.includes('local proxy') || lower.includes('proxy') || m.includes('프록시')) return 'proxy';
          if (lower.includes('openai') || lower.includes('openai_direct')) return 'openai';
          return 'unknown';
        };

        void (async () => {
          try {
            const svc = getDcbotService();
            await svc.logError({
              ts: Date.now(),
              scope: 'content',
              message: `생성 실패: ${msg}`,
              detail: `stage=generate op=${op} provider=${settings.providerMode} host=${location.hostname} class=${classify(msg)}`,
            });
          } catch {
            // ignore
          }
        })();
      } finally {
        processing.delete(commentId);
      }
    }

    async function handleInsert(nodeEl: HTMLElement, commentId: string, ui: HTMLElement) {
      const status = ui.querySelector<HTMLElement>('.dcbot-ui__status');
      const btnInsert = ui.querySelector<HTMLButtonElement>('.dcbot-ui__btn--insert');
      const rawAnswer = (ui as any)._dcbotAnswer as string | undefined;
      if (!rawAnswer) return;
      const answer = clampAnswer(rawAnswer);
      if (!answer) return;

      try {
        btnInsert && (btnInsert.disabled = true);
        status && (status.textContent = '답글창 여는 중…');

        await adapter.openReply({ el: nodeEl, id: commentId });
        const ta = await adapter.findReplyTextarea({ el: nodeEl, id: commentId });
        if (!ta) throw new Error('답글 입력창을 찾지 못했습니다.');

        adapter.fillTextarea(ta, answer);
        status && (status.textContent = '삽입 완료');

        // autoSubmit handling (captcha check)
        if (settings.autoSubmit) {
          const container =
            ta.closest<HTMLElement>('.cmt_write_box') ??
            ta.closest<HTMLElement>('li') ??
            ta.closest<HTMLElement>('form') ??
            (ta.parentElement instanceof HTMLElement ? ta.parentElement : null) ??
            document.body;
          if (adapter.detectCaptcha(container)) {
            status && (status.textContent = '자동등록방지 감지됨: 자동 등록 중단');
          } else {
            status && (status.textContent = '등록 중…');
            adapter.submitReply(container);
            status && (status.textContent = '등록 클릭 완료');
          }
        }

        handled.add(commentId);
        const svc = getDcbotService();
        await svc.markCommentHandled(commentId);
        ui.setAttribute('data-dcbot-handled', '1');
        nodeEl.setAttribute('data-dcbot-handled', '1');
      } catch (error) {
        const msg = toUserMessage(error);
        const diag = adapter.collectDiagnostics({ el: nodeEl, id: commentId });
        status && (status.textContent = `오류: ${msg} | ${diag}`);
        btnInsert && (btnInsert.disabled = false);

        void (async () => {
          try {
            const svc = getDcbotService();
            await svc.logError({ ts: Date.now(), scope: 'content', message: msg, detail: diag });
          } catch {
            // ignore
          }
        })();
      }
    }

    function wireUi(nodeEl: HTMLElement, commentId: string, commentText: string) {
      if (nodeEl.getAttribute('data-dcbot-wired') === '1') return;
      ensureStyles();
      const ui = adapter.injectActionUi({ el: nodeEl, id: commentId });
      if (ui.getAttribute('data-dcbot-wired') === '1') {
        nodeEl.setAttribute('data-dcbot-wired', '1');
        return;
      }
      ui.setAttribute('data-dcbot-wired', '1');
      nodeEl.setAttribute('data-dcbot-wired', '1');

      const status = ui.querySelector<HTMLElement>('.dcbot-ui__status');
      const btnGen = ui.querySelector<HTMLButtonElement>('.dcbot-ui__btn--gen');
      const btnInsert = ui.querySelector<HTMLButtonElement>('.dcbot-ui__btn--insert');

      if (handled.has(commentId)) {
        ui.setAttribute('data-dcbot-handled', '1');
        nodeEl.setAttribute('data-dcbot-handled', '1');
        if (status) status.textContent = '처리됨';
        if (btnGen) btnGen.disabled = true;
        if (btnInsert) btnInsert.disabled = true;
        return;
      }

      btnGen?.addEventListener('click', () => handleGenerate(nodeEl, commentId, commentText, ui));
      btnInsert?.addEventListener('click', () => handleInsert(nodeEl, commentId, ui));

      if (settings.autoReply) {
        void handleGenerate(nodeEl, commentId, commentText, ui);
      }
    }

    function processCommentNode(node: CommentNode, opts?: { forceRescan?: boolean }): { scanned: boolean; wired: boolean } {
      if (node.el.getAttribute('data-dcbot-handled') === '1') return { scanned: false, wired: false };
      if (node.el.getAttribute('data-dcbot-wired') === '1') return { scanned: false, wired: false };
      if (!opts?.forceRescan && node.el.getAttribute('data-dcbot-scanned-trigger') === settings.trigger) {
        return { scanned: false, wired: false };
      }

      node.el.setAttribute('data-dcbot-scanned-trigger', settings.trigger);
      const text = adapter.getCommentText(node);
      const id = adapter.getCommentId(node);
      if (!adapter.hasTrigger(text, settings.trigger)) return { scanned: true, wired: false };
      if (settings.onlyMyTrigger && !isLikelyMyTriggerComment(node.el)) {
        if (settings.debug) console.log('[DCBot] ignore trigger from other user', { commentId: id });
        return { scanned: true, wired: false };
      }

      // If the trigger comment already has "my" reply under it, treat it as handled to avoid repeated API calls.
      if (!handled.has(id) && hasExistingMyReply(node.el, id)) {
        handled.add(id);
        void (async () => {
          try {
            const svc = getDcbotService();
            await svc.markCommentHandled(id);
          } catch {
            // ignore
          }
        })();
      }
      wireUi(node.el, id, text);
      return { scanned: true, wired: true };
    }

    function maybeStartFullScan(now: number) {
      if (fullScanState && document.contains(fullScanState.root)) return;
      fullScanState = null;

      const root = adapter.findCommentRoot();
      if (!root) return;
      fullScanState = { root, nodes: adapter.listComments(root), index: 0 };
      needsFullScan = false;
      lastFullScanAt = now;
    }

    function enqueueCommentEl(el: HTMLElement): boolean {
      const { maxPending } = getScanBudget();
      if (pendingCommentEls.has(el)) return false;
      if (pendingCommentEls.size >= maxPending) {
        pendingCommentEls.clear();
        needsFullScan = true;
        return false;
      }
      pendingCommentEls.add(el);
      return true;
    }

    function enqueueFromNode(node: Node, remaining: number): number {
      if (remaining <= 0) return 0;
      if (!(node instanceof HTMLElement)) return 0;

      if (node.matches(COMMENT_CONTAINER_SELECTOR)) return enqueueCommentEl(node) ? 1 : 0;

      const closest = node.closest<HTMLElement>(COMMENT_CONTAINER_SELECTOR);
      if (closest) return enqueueCommentEl(closest) ? 1 : 0;

      // Avoid expensive subtree selectors in mutation observers (can freeze pages on large DOM updates).
      // Instead, fall back to time-sliced full scan.
      needsFullScan = true;
      return 0;
    }

    function enqueueFromMutations(records: MutationRecord[]) {
      const { maxEnqueueFromMutations } = getScanBudget();
      let remaining = maxEnqueueFromMutations;
      for (const r of records) {
        if (remaining <= 0) break;
        if (r.target instanceof HTMLElement && r.target.matches(COMMENT_CONTAINER_SELECTOR)) {
          if (enqueueCommentEl(r.target)) remaining -= 1;
        }

        for (const n of Array.from(r.addedNodes)) {
          if (remaining <= 0) break;
          const added = enqueueFromNode(n, remaining);
          remaining -= added;
        }
      }
    }

    function scanSlice() {
      if (!settings.debug && document.visibilityState !== 'visible') return;
      ensureObserverBound();

      // If the page temporarily doesn't have a comment root yet, back off instead of busy-looping.
      const nowTs = Date.now();
      if (observerMode === 'document') {
        if (nowTs < noRootUntil) return;
        const root = adapter.findCommentRoot();
        if (!root) {
          needsFullScan = false;
          fullScanState = null;
          noRootUntil = nowTs + noRootBackoffMs;
          noRootBackoffMs = Math.min(5000, Math.round(noRootBackoffMs * 1.6));
          scheduleScan({ delayMs: noRootBackoffMs });
          return;
        }
        // Reset backoff once we see comments.
        noRootBackoffMs = 500;
        noRootUntil = 0;
      }
      const budget = getScanBudget();

      const started = performance.now();
      const now = nowTs;
      scanTimestamps.push(now);
      while (scanTimestamps.length > 0 && now - scanTimestamps[0]! > 60_000) scanTimestamps.shift();

      let scanned = 0;
      let newlyWired = 0;

      // 1) Incremental: process candidates from mutations first.
      while (pendingCommentEls.size > 0) {
        if (scanned >= budget.maxNodes) break;
        if (performance.now() - started >= budget.maxMs) break;

        const el = pendingCommentEls.values().next().value as HTMLElement | undefined;
        if (!el) break;
        pendingCommentEls.delete(el);
        if (!document.contains(el)) continue;

        const res = processCommentNode(adapter.makeCommentNode(el));
        if (res.scanned) scanned += 1;
        if (res.wired) newlyWired += 1;
      }

      // 2) Fallback: time-sliced full scan (startup + debug periodic).
      const shouldFullScan =
        needsFullScan || (budget.fullScanIntervalMs > 0 && now - lastFullScanAt > budget.fullScanIntervalMs);
      if (shouldFullScan && !fullScanState) {
        maybeStartFullScan(now);
      }

      if (fullScanState && !document.contains(fullScanState.root)) {
        fullScanState = null;
        needsFullScan = true;
      }

      while (fullScanState) {
        if (scanned >= budget.maxNodes) break;
        if (performance.now() - started >= budget.maxMs) break;
        if (fullScanState.index >= fullScanState.nodes.length) {
          fullScanState = null;
          break;
        }

        const node = fullScanState.nodes[fullScanState.index++]!;
        const res = processCommentNode(node);
        if (res.scanned) scanned += 1;
        if (res.wired) newlyWired += 1;
      }

      const remainingFull = fullScanState ? fullScanState.nodes.length - fullScanState.index : 0;
      const durationMs = performance.now() - started;
      const moreWork = pendingCommentEls.size > 0 || remainingFull > 0 || needsFullScan;

      if (settings.debug && now - lastDebugStatsAt > 5000) {
        lastDebugStatsAt = now;
        console.log(
          `[dcbot] scan slice scanned=${scanned} wired=${newlyWired} pending=${pendingCommentEls.size} fullRemain=${remainingFull} scans/min=${scanTimestamps.length} durMs=${durationMs.toFixed(
            1,
          )}`,
        );
      }

      if (moreWork) {
        scheduleScan({ delayMs: settings.debug ? 30 : 80 });
      }
    }

    function scheduleScan(opts?: { delayMs?: number }) {
      if (!settings.debug && document.visibilityState !== 'visible') return;
      if (scanTimer != null) return;
      ensureObserverBound();
      const delay = opts?.delayMs ?? (settings.debug ? 180 : 280);
      scanTimer = window.setTimeout(() => {
        scanTimer = null;
        scanSlice();
      }, delay);
    }

    function bindObserverToDocument() {
      if (!observer) return;
      observer.disconnect();
      observedRoot = null;
      observerMode = 'document';
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }

    function bindObserverToCommentsRoot(root: Element) {
      if (!observer) return;
      observer.disconnect();
      observedRoot = root;
      observerMode = 'comments';
      observer.observe(root, { childList: true, subtree: true });
      if (settings.debug) console.log('[dcbot] observing comment root', root);
    }

    function ensureObserverBound() {
      if (!observer) return;

      if (observerMode === 'comments') {
        if (observedRoot && !document.contains(observedRoot)) {
          if (settings.debug) console.log('[dcbot] comment root detached; fallback to document observer');
          bindObserverToDocument();
          needsFullScan = true;
          fullScanState = null;
        }
        return;
      }

      // Document-wide observation is intentionally "light": we only switch to comment-root observation once found.
      const root = adapter.findCommentRoot();
      if (!root) return;
      bindObserverToCommentsRoot(root);
      needsFullScan = true;
      fullScanState = null;
    }

    observer = new MutationObserver((records) => {
      if (observerMode === 'comments') {
        enqueueFromMutations(records);
        scheduleScan();
        return;
      }

      // Avoid expensive selector work on the whole document; just nudge a scan and try rebinding later.
      needsFullScan = true;
      scheduleScan({ delayMs: settings.debug ? 120 : 500 });
    });

    const initialRoot = adapter.findCommentRoot();
    if (initialRoot) bindObserverToCommentsRoot(initialRoot);
    else bindObserverToDocument();

    // settings update
    browser.storage.onChanged.addListener((changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, areaName: string) => {
      if (areaName !== 'sync') return;
      if (!changes.settings) return;
      void (async () => {
        settings = await getSettings();
        if (settings.debug) console.log('[dcbot] settings updated', settings);
        needsFullScan = true;
        fullScanState = null;
        scheduleScan({ delayMs: 0 });
      })();
    });

    scheduleScan({ delayMs: 0 });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') scheduleScan();
    });

    // NOTE: MutationObserver is initialized above (document → comment root rebind).
  },
});
