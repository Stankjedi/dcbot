import { beforeEach, describe, expect, it, afterEach } from 'vitest';
import { createDcinsideAdapter } from '@/lib/adapter/dcinsideAdapter';

function stubElementVisibility() {
  const original = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function () {
    return { x: 0, y: 0, top: 0, left: 0, bottom: 10, right: 10, width: 10, height: 10, toJSON: () => {} } as any;
  };
  return () => {
    HTMLElement.prototype.getBoundingClientRect = original;
  };
}

describe('dcinsideAdapter', () => {
  let restoreRect: (() => void) | null = null;

  beforeEach(() => {
    restoreRect = stubElementVisibility();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
    restoreRect?.();
    restoreRect = null;
  });

  it('findCommentRoot prefers DCInside selectors and lists comments (desktop-like)', () => {
    document.body.innerHTML = `
      <div id="comment_wrap">
        <ul>
          <li id="comment_123" data-no="123">
            <div class="usertxt">@디시봇 1+1이 뭐야?</div>
            <button type="button">답글</button>
          </li>
        </ul>
      </div>
    `;

    const adapter = createDcinsideAdapter();
    const root = adapter.findCommentRoot();
    expect(root).toBeTruthy();
    expect((root as HTMLElement).id).toBe('comment_wrap');

    const nodes = adapter.listComments(root!);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.id).toBe('123');

    const text = adapter.getCommentText(nodes[0]!);
    expect(text).toBe('@디시봇 1+1이 뭐야?');
    expect(adapter.extractQuestion(text, '@디시봇')).toBe('1+1이 뭐야?');

    const diag = adapter.collectDiagnostics(nodes[0]!);
    expect(diag).toContain('diag root=');
    expect(diag).toContain('replyBtns=1');
  });

  it('supports alternative comment containers and text selectors', () => {
    document.body.innerHTML = `
      <div class="comment_box">
        <ul>
          <li data-comment-no="77">
            <span class="cmt_txt">@디시봇: 테스트</span>
            <a href="#">답글</a>
          </li>
        </ul>
      </div>
    `;

    const adapter = createDcinsideAdapter();
    const root = adapter.findCommentRoot();
    expect(root).toBeTruthy();
    expect((root as HTMLElement).className).toContain('comment_box');

    const nodes = adapter.listComments(root!);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.id).toBe('77');

    const text = adapter.getCommentText(nodes[0]!);
    expect(text).toBe('@디시봇: 테스트');
    expect(adapter.extractQuestion(text, '@디시봇')).toBe('테스트');
  });

  it('falls back to a stable auto id when no id/dataset is present', () => {
    document.body.innerHTML = `
      <div id="comment_wrap">
        <ul>
          <li class="comment">
            <div class="comment_memo">그냥 댓글</div>
          </li>
        </ul>
      </div>
    `;

    const adapter = createDcinsideAdapter();
    const root = adapter.findCommentRoot();
    expect(root).toBeTruthy();

    const nodes = adapter.listComments(root!);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.id.startsWith('auto_')).toBe(true);
  });
});

