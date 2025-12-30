# AI Agent Improvement Prompts

## Mandatory execution rules
- Execute prompts strictly in order (PROMPT-001 → PROMPT-002 → PROMPT-003 → OPT-1). Do not skip or reorder.
- Do not respond with text-only explanations. For every prompt, apply real repo changes using file-edit tools (`replace_string_in_file`, `multi_replace_string_in_file`, `create_file`).
- After each prompt: run the verification commands, ensure they pass, then confirm completion and proceed to the next prompt.
- Never store secrets in sync storage. Keep secrets in local extension storage or server environment variables only.
- Never log secrets (API keys, auth headers, proxy tokens, full page HTML, full post/question text).

## Execution checklist

| # | Prompt ID | Title | Priority | Status |
|:---:|:---|:---|:---:|:---:|
| 1 | PROMPT-001 | Add privacy controls for LLM context | P2 | ⬜ Pending |
| 2 | PROMPT-002 | Add allowlist helper UI (extension origin copy) | P2 | ⬜ Pending |
| 3 | PROMPT-003 | Add "Clear handled comments" action in Options | P3 | ⬜ Pending |
| 4 | OPT-1 | Optimize recent comments context extraction | OPT | ⬜ Pending |

Total: 4 prompts | Completed: 0 | Remaining: 4

---

## P2 (Important)

### [PROMPT-001] Add privacy controls for LLM context
Execute this prompt now, then proceed to PROMPT-002.

Task:
- Add user-facing controls to minimize what page context is sent to the LLM during QA mode (post title/body and nearby comments), while keeping summary mode functional.

Target files:
- `src/lib/storage/settings.ts`
- `src/lib/storage/settings.test.ts`
- `src/lib/llm/prompt.ts`
- `src/lib/llm/prompt.test.ts`
- `src/entrypoints/content-scripts/dcinside.ts`
- `src/entrypoints/options/App.tsx`
- `README.md`

Steps:
1. Extend `Settings` (sync storage, non-secret):
   - Add:
     - `includePostContext: boolean` (default `true`)
     - `includeRecentCommentsContext: boolean` (default `true`)
     - `recentCommentsLimit: number` (default `8`, clamp `0..10`)
   - Update `DEFAULT_SETTINGS` and `normalizeSettings()` accordingly.
2. Gate context in the content script:
   - In `dcinside.ts`, for `mode: "qa"`:
     - Set `postTitle` and `postBodyText` to `undefined` when `includePostContext` is `false`.
     - Set `recentComments` to `undefined` when `includeRecentCommentsContext` is `false`.
     - Pass `settings.recentCommentsLimit` into the recent-comments extractor.
   - For `mode: "summary"`: always send `postTitle/postBodyText` (summary requires them), and keep `recentComments` undefined.
3. Ensure prompt builders stay clean:
   - `buildPrompt(...)` should omit empty sections when a field is `undefined` or empty.
   - Add a unit test to confirm the omission behavior.
4. Add Options UI controls:
   - Add a "Privacy / Context" card with:
     - Checkbox: include post title/body in QA
     - Checkbox: include nearby comments in QA
     - Number input: nearby comments limit (0-10), disabled when the checkbox is off
   - Persist changes via `svc.setSettings(...)`.
5. Document the behavior:
   - Update `README.md` (keep it Korean) to explain the privacy/context toggles and recommended safer configurations.
6. Tests:
   - `settings.test.ts`: default values + clamping for `recentCommentsLimit`.
   - `prompt.test.ts`: verify QA prompt text does not include post/recent-comment sections when disabled.

Implementation requirements:
- Do not store any secret in `browser.storage.sync`.
- Do not log or export full page/post/comment text.

Verification:
- `pnpm run compile`
- `pnpm run test`
- `pnpm run build`

After completing this prompt, proceed to [PROMPT-002].

---

### [PROMPT-002] Add allowlist helper UI (extension origin copy)
Execute this prompt now, then proceed to PROMPT-003.

Task:
- Reduce configuration mistakes by showing the exact extension Origin and providing a one-click copy action for server allowlist setup (`DCBOT_ALLOWED_ORIGINS`).

Target files:
- `src/entrypoints/options/App.tsx`
- `README.md` (optional, keep it Korean)

Steps:
1. Compute and display the extension Origin:
   - Use `browser.runtime.id` and display `chrome-extension://${browser.runtime.id}` as a read-only value.
2. Add a copy action:
   - Add a "Copy" button that uses `navigator.clipboard.writeText(origin)`.
   - Show a small status label (e.g., "Copied" / "Copy failed") without logging secrets.
3. Place it where users expect it:
   - Put the Origin display next to the local proxy allowlist guidance so users can paste it into `server/.env` as `DCBOT_ALLOWED_ORIGINS=...`.
4. Optional docs update:
   - Add a short note in `README.md` telling users they can copy the Origin from the Options page.

Implementation requirements:
- Never display or log secrets (API keys, proxy tokens).
- Do not add new dependencies.

Verification:
- `pnpm run compile`
- `pnpm run test`
- `pnpm run build`

After completing this prompt, proceed to [PROMPT-003].

---

## P3 (Enhancement)

### [PROMPT-003] Add "Clear handled comments" action in Options
Execute this prompt now, then proceed to OPT-1.

Task:
- Add a maintenance action in the Options page that clears the persisted handled-comment map so users can retry or demo the bot without reinstalling the extension.

Target files:
- `src/lib/storage/localState.ts`
- `src/lib/rpc/types.ts`
- `src/entrypoints/background/service.ts`
- `src/entrypoints/options/App.tsx`

Steps:
1. Storage helper:
   - In `src/lib/storage/localState.ts`, add:
     - `clearHandledCommentMap(): Promise<void>` that removes the handled-map storage key.
     - (Optional) `getHandledCommentCount(): Promise<number>` that returns the current count (read map and count keys).
2. RPC surface:
   - In `src/lib/rpc/types.ts`, add:
     - `getHandledCommentCount(): Promise<number>`
     - `clearHandledComments(): Promise<void>`
3. Background implementation:
   - In `src/entrypoints/background/service.ts`, implement the RPC methods by calling the `localState` helpers.
4. Options UI:
   - Add a small "Maintenance" (or "Advanced") card:
     - Show the handled count (from `svc.getHandledCommentCount()`).
     - Add a "Clear handled comments" button with a confirmation dialog.
     - After clearing, refresh the count and show a success/failure status.

Implementation requirements:
- Do not clear secrets or settings; only clear the handled-comment map.
- Do not add new dependencies.

Verification:
- `pnpm run compile`
- `pnpm run test`
- `pnpm run build`

After completing this prompt, proceed to [OPT-1].

---

## OPT (Optimization)

### [OPT-1] Optimize recent comments context extraction
Execute this prompt now, then proceed to the final completion section.

Task:
- Reduce CPU spikes on very large threads by avoiding a full root scan when collecting nearby comment context during answer generation.

Target files:
- `src/entrypoints/content-scripts/dcinside.ts`
- `src/lib/util/dom.ts` (new, recommended)
- `src/lib/util/dom.test.ts` (new, recommended)

Steps:
1. Add a small DOM traversal helper (testable):
   - Create `src/lib/util/dom.ts` with:
     - `export function collectNearbySiblings(start: HTMLElement, selector: string, maxItems: number): HTMLElement[]`
   - Behavior:
     - Never include `start` in the result.
     - Walk `previousElementSibling` and `nextElementSibling` outward (alternating is fine).
     - Only include elements that match `selector`.
     - Hard-cap to `maxItems` and return in the discovered order.
2. Use it in `dcinside.ts`:
   - Update `getRecentCommentsContext(...)` to:
     - First try `collectNearbySiblings(nodeEl, COMMENT_CONTAINER_SELECTOR, maxItems)` and build `recentComments` from those elements.
     - Keep the existing `adapter.listComments(root)` approach as a fallback only when sibling traversal yields no usable items.
   - Preserve existing trimming rules:
     - Normalize whitespace to a single space.
     - Drop empty strings.
     - Clamp each comment to ~200 chars with an ellipsis.
3. Tests:
   - Add `src/lib/util/dom.test.ts` (Vitest + jsdom) that verifies:
     - It returns only matching siblings and respects `maxItems`.
     - It never includes `start`.
4. Debug-only measurement (optional but recommended):
   - In `dcinside.ts`, when `settings.debug` is true, measure and log the duration of recent-comment extraction (ms) at low frequency.

Implementation requirements:
- Do not add new dependencies.
- Keep the helper bounded (no deep subtree scans; siblings only).

Verification:
- `pnpm run compile`
- `pnpm run test`
- `pnpm run build`

After completing this prompt, proceed to the final completion section.

---

## Final completion
- Confirm that all prompts in the checklist have been executed in order.
- Run final verification commands: `pnpm run compile`, `pnpm run test`, `pnpm run build`.
- Print exactly: `ALL PROMPTS COMPLETED. All pending improvement and optimization items from the latest report have been applied.`
