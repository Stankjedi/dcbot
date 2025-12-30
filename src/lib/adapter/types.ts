export type CommentNode = {
  el: HTMLElement;
  id: string;
};

export type DcinsideAdapter = {
  findCommentRoot(): Element | null;
  listComments(root: Element): CommentNode[];
  makeCommentNode(el: HTMLElement): CommentNode;
  getCommentText(node: CommentNode): string;
  getCommentId(node: CommentNode): string;
  hasTrigger(text: string, trigger: string): boolean;
  extractQuestion(text: string, trigger: string): string;

  injectActionUi(node: CommentNode): HTMLElement;

  collectDiagnostics(node: CommentNode): string;

  openReply(node: CommentNode): Promise<void>;
  findReplyTextarea(node: CommentNode): Promise<HTMLTextAreaElement | null>;
  fillTextarea(textarea: HTMLTextAreaElement, answer: string): void;
  detectCaptcha(container: Element): boolean;
  submitReply(container: Element): void;
};
