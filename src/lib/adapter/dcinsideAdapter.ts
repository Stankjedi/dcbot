import type { CommentNode, DcinsideAdapter } from '@/lib/adapter/types';
import { fnv1a32Hex } from '@/lib/util/hash';

function isVisible(el: Element): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  const style = getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function findByText(root: Element, selector: string, re: RegExp) {
  return Array.from(root.querySelectorAll(selector)).find((el) => re.test((el.textContent ?? '').trim()));
}

function describeElement(el: Element | null): string {
  if (!el) return 'null';
  const h = el as HTMLElement;
  const id = h.id ? `#${h.id}` : '';
  const cls =
    h.classList && h.classList.length > 0 ? `.${Array.from(h.classList).slice(0, 2).join('.')}` : '';
  return `${el.tagName.toLowerCase()}${id}${cls}`;
}

function firstVisibleTextareaWithin(root: Element): HTMLTextAreaElement | null {
  for (const t of Array.from(root.querySelectorAll('textarea'))) {
    if (isVisible(t)) return t;
  }
  return null;
}

function findDcinsideReplyWriteBox(commentId: string): HTMLElement | null {
  const el = document.getElementById('cmt_write_box');
  if (!(el instanceof HTMLElement)) return null;
  const dataNo = (el.getAttribute('data-no') ?? el.dataset?.no ?? '').trim();
  if (!dataNo) return null;
  if (dataNo !== commentId) return null;
  return el;
}

function findLikelyReplyContainer(commentEl: HTMLElement): Element | null {
  // Prefer forms or reply-like containers under the comment.
  const localCandidates: Element[] = [];

  for (const form of Array.from(commentEl.querySelectorAll('form'))) {
    if (form.querySelector('textarea')) localCandidates.push(form);
  }
  for (const el of Array.from(commentEl.querySelectorAll<HTMLElement>('[class*="reply"], [class*="reple"], [id*="reply"]'))) {
    if (el.querySelector('textarea')) localCandidates.push(el);
  }

  // Some layouts render the reply form right after the comment node.
  let sib: Element | null = commentEl.nextElementSibling;
  for (let i = 0; i < 4 && sib; i++) {
    if (sib instanceof HTMLElement && sib.querySelector('textarea')) localCandidates.push(sib);
    sib = sib.nextElementSibling;
  }

  return localCandidates.find((el) => isVisible(el)) ?? localCandidates[0] ?? null;
}

function findReplyTextareaNearComment(commentEl: HTMLElement): HTMLTextAreaElement | null {
  const container = findLikelyReplyContainer(commentEl);
  if (container) {
    const t = firstVisibleTextareaWithin(container);
    if (t) return t;
  }

  return firstVisibleTextareaWithin(commentEl);
}

function extractIdFromElement(el: Element): string | null {
  const anyEl = el as HTMLElement;
  const dataset = (anyEl.dataset ?? {}) as Record<string, string | undefined>;
  const candidates = [
    dataset.no,
    dataset.commentNo,
    dataset.cmtNo,
    dataset.replyNo,
    anyEl.getAttribute('data-no') ?? undefined,
    anyEl.getAttribute('data-comment-no') ?? undefined,
  ].filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
  if (candidates.length > 0) return candidates[0]!.trim();

  const idAttr = anyEl.id ?? '';
  const match = idAttr.match(/\d{2,}/);
  if (match) return match[0];
  return null;
}

export function createDcinsideAdapter(options?: { getDebug?: () => boolean }): DcinsideAdapter {
  let cachedCommentRoot: Element | null = null;
  const autoIdByEl = new WeakMap<HTMLElement, string>();
  let autoIdSeq = 0;
  function isDebug() {
    try {
      return options?.getDebug?.() === true;
    } catch {
      return false;
    }
  }

  function getTextFromCommentEl(el: HTMLElement): string {
    const selectors = ['.usertxt', '.comment_memo', '.cmt_txt', '.txt', 'p'];
    for (const sel of selectors) {
      const t = (el.querySelector(sel)?.textContent ?? '').trim();
      if (t.length > 0) return t;
    }
    return (el.textContent ?? '').trim();
  }

  function findCommentRoot() {
    if (cachedCommentRoot && document.contains(cachedCommentRoot)) return cachedCommentRoot;

    const selectors = [
      '#comment_wrap',
      '#comment_box',
      '#comment',
      '.comment_wrap',
      '.comment_box',
      '#cmt_list',
      '.cmt_list',
      '#comment_list',
      '.comment_list',
      // Mobile/common variants
      '#reply_list',
      '.reply_list',
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        cachedCommentRoot = el;
        return el;
      }
    }

    if (!isDebug()) return null;

    // Fallback: search only "comment-ish" containers and pick the best-scoring candidate.
    const fallbackCandidates = Array.from(
      document.querySelectorAll<HTMLElement>(
        [
          'div[id*="comment"]',
          'section[id*="comment"]',
          'article[id*="comment"]',
          'div[class*="comment"]',
          'section[class*="comment"]',
          'article[class*="comment"]',
          'div[id*="cmt"]',
          'div[class*="cmt"]',
        ].join(','),
      ),
    );

    let best: Element | null = null;
    let bestScore = 0;

    const maxCandidates = isDebug() ? 200 : 120;
    for (const el of fallbackCandidates.slice(0, maxCandidates)) {
      const commentItems = el.querySelectorAll('li[id^="comment_"], li[id^="cmt_"], li[data-no], li[data-comment-no]').length;
      if (commentItems === 0) continue;
      const replyButtons = Array.from(el.querySelectorAll('a,button')).filter((b) => /답글/.test((b.textContent ?? '').trim())).length;
      const score = commentItems * 2 + replyButtons;
      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }

    cachedCommentRoot = best;
    return best;
  }

  function makeCommentNode(el: HTMLElement): CommentNode {
    const stableText = getTextFromCommentEl(el);
    const extracted = extractIdFromElement(el);
    if (extracted) return { el, id: extracted };

    const existing = autoIdByEl.get(el);
    if (existing) return { el, id: existing };

    autoIdSeq += 1;
    const id = `auto_${autoIdSeq.toString(16)}_${fnv1a32Hex(stableText).slice(0, 8)}`;
    autoIdByEl.set(el, id);
    return { el, id };
  }

  function listComments(root: Element): CommentNode[] {
    const candidates = Array.from(
      root.querySelectorAll<HTMLElement>(
        [
          'li[id^="comment_"]',
          'li[id^="cmt_"]',
          'li[data-no]',
          'li[data-comment-no]',
          'li.ub-content',
          'li.reply',
          'li.comment',
          'tr[data-no]',
          'tr[data-comment-no]',
          'div[data-no]',
          'div[data-comment-no]',
        ].join(','),
      ),
    );

    const fallback = (() => {
      if (candidates.length > 0) return candidates;

      // DCInside-first fallback: use known text nodes and walk up to a likely container.
      const textNodes = Array.from(root.querySelectorAll<HTMLElement>('.usertxt, .comment_memo, .cmt_txt, .txt'));
      const containers = new Set<HTMLElement>();
      for (const t of textNodes) {
        const c = t.closest<HTMLElement>('li, tr, article, div');
        if (c) containers.add(c);
      }
      const picked = Array.from(containers);
      if (picked.length > 0) return picked;

      // Broad fallback is debug-only.
      if (!isDebug()) return [];

      return Array.from(root.querySelectorAll<HTMLElement>('li')).filter((el) => {
        const text = (el.textContent ?? '').trim();
        if (text.length < 2) return false;
        if (el.querySelector('.usertxt, .comment_memo, .cmt_txt, .txt')) return true;
        return !!findByText(el, 'a,button', /답글/);
      });
    })();

    const out: CommentNode[] = [];
    for (const el of fallback) {
      const text = getTextFromCommentEl(el);
      if (text.length < 2) continue;
      out.push(makeCommentNode(el));
    }
    return out;
  }

  function getCommentText(node: CommentNode): string {
    return getTextFromCommentEl(node.el);
  }

  function getCommentId(node: CommentNode): string {
    return node.id;
  }

  function hasTrigger(text: string, trigger: string): boolean {
    return text.includes(trigger);
  }

  function extractQuestion(text: string, trigger: string): string {
    const idx = text.indexOf(trigger);
    if (idx < 0) return '';
    return text
      .slice(idx + trigger.length)
      .replace(/^[:：\-\s]+/, '')
      .trim();
  }

  function injectActionUi(node: CommentNode): HTMLElement {
    const existing = node.el.querySelector<HTMLElement>('.dcbot-ui');
    if (existing) return existing;

    const wrap = document.createElement('div');
    wrap.className = 'dcbot-ui';
    wrap.innerHTML = `
      <div class="dcbot-ui__row">
        <button type="button" class="dcbot-ui__btn dcbot-ui__btn--gen">답변 생성</button>
        <button type="button" class="dcbot-ui__btn dcbot-ui__btn--insert" disabled>삽입</button>
        <span class="dcbot-ui__status"></span>
      </div>
      <pre class="dcbot-ui__preview" style="display:none"></pre>
    `;

    node.el.appendChild(wrap);
    return wrap;
  }

  function collectDiagnostics(node: CommentNode): string {
    const root = findCommentRoot();
    const replyBtnCount = Array.from(node.el.querySelectorAll('a,button')).filter((b) => /답글/.test((b.textContent ?? '').trim())).length;
    const taLocalCount = Array.from(node.el.querySelectorAll('textarea')).filter((t) => isVisible(t)).length;
    const replyContainer = findLikelyReplyContainer(node.el);
    const taReplyCount = replyContainer ? Array.from(replyContainer.querySelectorAll('textarea')).filter((t) => isVisible(t)).length : 0;
    const active = document.activeElement;
    const activeTa = active instanceof HTMLTextAreaElement && isVisible(active) ? 'yes' : 'no';
    const writeBox = document.getElementById('cmt_write_box');
    const writeBoxNo =
      writeBox instanceof HTMLElement ? (writeBox.getAttribute('data-no') ?? writeBox.dataset?.no ?? '').trim() : '';
    return `diag root=${describeElement(root)} node=${describeElement(node.el)} replyBtns=${replyBtnCount} taLocal=${taLocalCount} taReply=${taReplyCount} taActive=${activeTa} writeBox=${describeElement(writeBox)} writeBoxNo=${writeBoxNo || 'n/a'}`;
  }

  async function openReply(node: CommentNode): Promise<void> {
    // If a reply box is already open for this comment, don't re-trigger (DCInside uses #cmt_write_box for the active reply form).
    const writeBox = findDcinsideReplyWriteBox(node.id);
    if (writeBox) {
      const existingTa = firstVisibleTextareaWithin(writeBox);
      if (existingTa) return;
    }

    // DCInside 최신 구조: .btn_reply_write_all 클릭으로 답글창 열기
    const dcReplyTrigger = node.el.querySelector<HTMLElement>('.btn_reply_write_all');
    if (dcReplyTrigger && isVisible(dcReplyTrigger)) {
      dcReplyTrigger.click();
      return;
    }

    // 대체: .btn_reply_write 클릭
    const dcReplyBtn = node.el.querySelector<HTMLElement>('.btn_reply_write');
    if (dcReplyBtn && isVisible(dcReplyBtn)) {
      dcReplyBtn.click();
      return;
    }

    // Some skins attach the click handler on the text container itself.
    if (node.el.matches?.('.btn_reply_write_all, .btn_reply_write')) {
      node.el.click();
      return;
    }

    // 폴백: "답글" 텍스트가 있는 버튼 찾기
    const replyCandidates = Array.from(node.el.querySelectorAll<HTMLElement>('a,button'))
      .filter((el) => isVisible(el))
      .filter((el) => /답글/.test((el.textContent ?? '').trim()));

    const replyBtn =
      replyCandidates.find((el) => (el.textContent ?? '').trim() === '답글') ??
      replyCandidates[0] ??
      findByText(node.el, 'a,button', /^답글$/) ??
      findByText(node.el, 'a,button', /답글/) ??
      node.el.querySelector<HTMLElement>('[class*="reply"], [onclick*="reply"]');

    if (replyBtn && replyBtn instanceof HTMLElement) {
      replyBtn.click();
      return;
    }

    // mgallery 일부 스킨: 댓글(본문) 클릭 시 답글 입력칸이 아래에 생성됨
    const clickTargets = [
      '.usertxt',
      '.comment_memo',
      '.cmt_txt',
      '.txt',
      '.cmt_txt_cont',
      '.cmt_write',
      'p',
    ];
    for (const sel of clickTargets) {
      const el = node.el.querySelector<HTMLElement>(sel);
      if (!el) continue;
      if (!isVisible(el)) continue;
      if (el.closest('.dcbot-ui')) continue;
      el.click();
      return;
    }

    if (isVisible(node.el)) {
      node.el.click();
      return;
    }
    throw new Error('답글 버튼을 찾지 못했습니다.');
  }

  async function findReplyTextarea(node: CommentNode): Promise<HTMLTextAreaElement | null> {
    const start = Date.now();
    while (Date.now() - start < 2500) {
      // DCInside comment.js uses a single active reply form container: <div id="cmt_write_box" data-no="{commentId}"> ... <textarea id="memo_{commentId}">
      const writeBox = findDcinsideReplyWriteBox(node.id);
      if (writeBox) {
        const taById = writeBox.querySelector<HTMLTextAreaElement>(`textarea#memo_${CSS.escape(node.id)}`);
        if (taById && isVisible(taById)) return taById;
        const ta = firstVisibleTextareaWithin(writeBox);
        if (ta) return ta;
      }

      // If the site rendered multiple containers, search by textarea id but avoid the main comment box (memo_{articleNo}) by requiring proximity.
      const anyTa = document.getElementById(`memo_${node.id}`);
      if (anyTa instanceof HTMLTextAreaElement && isVisible(anyTa)) {
        const ok =
          !!anyTa.closest('#cmt_write_box') ||
          !!anyTa.closest('ul.reply_list') ||
          !!anyTa.closest('li[id^="reply_empty_"]') ||
          !!anyTa.closest('div.reply');
        if (ok) return anyTa;
      }

      // 폴백
      const ta = findReplyTextareaNearComment(node.el);
      if (ta) return ta;
      await new Promise((r) => setTimeout(r, 100));
    }
    return null;
  }

  function fillTextarea(textarea: HTMLTextAreaElement, answer: string) {
    textarea.focus();
    textarea.value = answer;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function detectCaptcha(container: Element): boolean {
    const text = (container.textContent ?? '').replace(/\s+/g, '');
    if (text.includes('자동등록방지')) return true;
    if (text.includes('자동등록방지코드')) return true;
    return false;
  }

  function submitReply(container: Element) {
    // DCInside 최신 구조: .repley_add 버튼 (사이트 코드에 오타 있음)
    const dcSubmitBtn = container.querySelector<HTMLElement>('button.repley_add');
    if (dcSubmitBtn && isVisible(dcSubmitBtn)) {
      dcSubmitBtn.click();
      return;
    }

    // 대체: btn_blue 등록 버튼
    const blueBtnSubmit = container.querySelector<HTMLElement>('button.btn_blue');
    if (blueBtnSubmit && isVisible(blueBtnSubmit) && /등록/.test(blueBtnSubmit.textContent ?? '')) {
      blueBtnSubmit.click();
      return;
    }

    // 폴백: "등록" 또는 "확인" 텍스트가 있는 버튼
    const btn =
      findByText(container, 'button,input[type="button"],input[type="submit"]', /등록|확인/) ??
      container.querySelector<HTMLElement>('[class*="btn"], [onclick*="comment"]');
    if (!btn || !(btn instanceof HTMLElement)) throw new Error('등록 버튼을 찾지 못했습니다.');
    btn.click();
  }

  return {
    findCommentRoot,
    listComments,
    makeCommentNode,
    getCommentText,
    getCommentId,
    hasTrigger,
    extractQuestion,
    injectActionUi,
    collectDiagnostics,
    openReply,
    findReplyTextarea,
    fillTextarea,
    detectCaptcha,
    submitReply,
  };
}
