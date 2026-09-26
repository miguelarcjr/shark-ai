# WhatsApp Media Attachments & `send_file` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable Shark AI to send media and files (e.g. Playwright video recordings `.webm`, screenshots, PDFs, documents) via WhatsApp and CLI through a new `send_file` tool and native `WhatsAppAdapter` transport handling.

**Architecture:** A channel-agnostic `send_file` tool in `AgentActionExecutor` inspects target files, resolves absolute paths, determines MIME types, and dispatches `OutboundMediaAttachment` events. `WhatsAppAdapter` routes these events to the underlying `WhatsAppTransport` (`Baileys`), sending videos, images, or documents natively to the chat, while `CliAdapter` renders a formatted box with local clickable file links.

**Tech Stack:** TypeScript, Node.js (`node:fs`, `node:path`), `@whiskeysockets/baileys`, Vitest.

## Global Constraints
- Node >= 22.0.0, ESM (`"type": "module"`).
- Zero external runtime dependencies for MIME detection (pure TypeScript extension mapping).
- Keep core engine decoupled from Baileys / transport specifics.
- All tasks must follow TDD (failing test -> implementation -> pass -> commit).

---

### Task 1: Extend WhatsAppTransport & WhatsAppAdapter for media_attachment

**Files:**
- Modify: `src/core/adapters/whatsapp/whatsapp-adapter.ts`
- Modify: `src/core/adapters/whatsapp/whatsapp-adapter.test.ts`

**Interfaces:**
- Produces in `whatsapp-adapter.ts`:
  ```typescript
  export interface WhatsAppTransport {
      sendText(chatId: string, text: string): Promise<void>;
      editMessage?(chatId: string, messageId: string, text: string): Promise<void>;
      sendMedia?(chatId: string, media: {
          filePath: string;
          mimeType: string;
          caption?: string;
          fileName?: string;
      }): Promise<void>;
      onRawMessage(handler: (chatId: string, text: string, senderId: string) => void): void;
  }
  ```

- [ ] **Step 1: Write failing test in whatsapp-adapter.test.ts**
Add tests:
- When `emit({ type: 'media_attachment', sessionId: 'whatsapp:dm:123', filePath: '/test.webm', mimeType: 'video/webm', caption: 'Playwright test' })`:
  - If `transport.sendMedia` is defined, calls `transport.sendMedia('123', ...)` with matching properties.
  - If `transport.sendMedia` is undefined, falls back to `transport.sendText` with informative text containing path and caption.

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run src/core/adapters/whatsapp/whatsapp-adapter.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement media_attachment handling in WhatsAppAdapter**
In `src/core/adapters/whatsapp/whatsapp-adapter.ts`:
- Update `WhatsAppTransport` interface with optional `sendMedia`.
- In `emit(event)`:
  - Add `else if (event.type === 'media_attachment')`.
  - Extract `chatId = event.sessionId.replace(/^whatsapp:dm:/, '')`.
  - Extract `fileName = path.basename(event.filePath)`.
  - Dispatch to `this.transport.sendMedia` or fallback to `this.transport.sendText`.

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run src/core/adapters/whatsapp/whatsapp-adapter.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/core/adapters/whatsapp/whatsapp-adapter.ts src/core/adapters/whatsapp/whatsapp-adapter.test.ts
git commit -m "feat(whatsapp): support media_attachment in WhatsAppTransport and WhatsAppAdapter"
```

---

### Task 2: Create MIME Detector Utility and send_file Tool in AgentActionExecutor

**Files:**
- Create: `src/core/utils/mime-detector.ts`
- Create: `src/core/utils/mime-detector.test.ts`
- Modify: `src/core/engine/agent-action-executor.ts`
- Modify: `src/core/engine/agent-action-executor.test.ts`

**Interfaces:**
- Produces in `src/core/utils/mime-detector.ts`:
  ```typescript
  export function detectMimeType(filePath: string): string;
  ```
- Exposes action `send_file` in `AgentActionExecutor.executeAction()`.

- [ ] **Step 1: Write failing test for detectMimeType**
Create `src/core/utils/mime-detector.test.ts`:
- Returns `video/webm` for `.webm`, `video/mp4` for `.mp4`.
- Returns `image/png` for `.png`, `image/jpeg` for `.jpg` / `.jpeg`.
- Returns `application/pdf` for `.pdf`, `application/json` for `.json`.
- Returns `application/octet-stream` for unknown extensions.

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run src/core/utils/mime-detector.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement detectMimeType**
Create `src/core/utils/mime-detector.ts` with clean extension-to-mime map.

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run src/core/utils/mime-detector.test.ts`
Expected: PASS.

- [ ] **Step 5: Write failing test for send_file in agent-action-executor.test.ts**
In `src/core/engine/agent-action-executor.test.ts`:
- Execute `send_file` on existing file: verifies `media_attachment` event is emitted with resolved path, mime, and caption, and result is successful.
- Execute `send_file` on non-existent file: returns failure message without emitting event.

- [ ] **Step 6: Run test to verify it fails**
Run: `npx vitest run src/core/engine/agent-action-executor.test.ts`
Expected: FAIL.

- [ ] **Step 7: Implement send_file action in AgentActionExecutor**
In `src/core/engine/agent-action-executor.ts`:
- Add `case 'send_file':` in `executeAction`.
- Validate file existence with `fs.existsSync`.
- Call `detectMimeType(resolvedPath)`.
- Emit `this.emitOutbound({ type: 'media_attachment', ... })`.
- Update `getToolDetails` and `getApprovalPrompt`.

- [ ] **Step 8: Run test to verify it passes**
Run: `npx vitest run src/core/engine/agent-action-executor.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**
```bash
git add src/core/utils/mime-detector.ts src/core/utils/mime-detector.test.ts src/core/engine/agent-action-executor.ts src/core/engine/agent-action-executor.test.ts
git commit -m "feat(engine): add send_file tool and MIME type detector"
```

---

### Task 3: Support media_attachment in CliAdapter / Terminal TUI

**Files:**
- Modify: `src/core/adapters/cli/cli-adapter.ts`
- Modify: `src/core/adapters/cli/cli-adapter.test.ts`

**Interfaces:**
- `CliAdapter.emit()` renders a visual card with emoji, file size, caption, and `file://` link when `event.type === 'media_attachment'`.

- [ ] **Step 1: Write failing test in cli-adapter.test.ts**
Test that `cliAdapter.emit({ type: 'media_attachment', ... })` formats and outputs caption, file link, and type.

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run src/core/adapters/cli/cli-adapter.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement media_attachment in CliAdapter**
In `src/core/adapters/cli/cli-adapter.ts`:
- Handle `event.type === 'media_attachment'`.
- Format file size (KB / MB).
- Print formatted box with clickable `file:///...` link and caption.

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run src/core/adapters/cli/cli-adapter.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/core/adapters/cli/cli-adapter.ts src/core/adapters/cli/cli-adapter.test.ts
git commit -m "feat(cli): display formatted media_attachment cards with file links"
```

---

### Task 4: Update System Prompts, Tool Schemas, and Response Parser

**Files:**
- Modify: `src/core/api/prompts.ts`
- Modify: `src/core/agents/agent-response-parser.ts`
- Modify: `src/core/agents/agent-response-parser.test.ts`

**Interfaces:**
- Add `'send_file'` to prompt action unions and schema.
- Add `caption` to `AgentActionSchema` and `TOOL_ARGS_PROPERTIES`.
- Document guidelines for using `send_file` with Playwright recordings, screenshots, and documents.

- [ ] **Step 1: Write failing test in agent-response-parser.test.ts**
Test parsing JSON with action `type: 'send_file'` and args `{ path: '.playwright-mcp/video.webm', caption: 'Test video' }`.

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run src/core/agents/agent-response-parser.test.ts`
Expected: FAIL.

- [ ] **Step 3: Update parser and prompts**
- In `src/core/agents/agent-response-parser.ts`:
  - Add `'send_file'` to enum.
  - Add `caption: z.string().nullable().optional()`.
- In `src/core/api/prompts.ts`:
  - Add `'send_file'` to `corePrompt` and `SUBAGENT_SYSTEM_PROMPT`.
  - Add `caption` to `TOOL_ARGS_PROPERTIES`.
  - Add guidelines for media attachments.

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run src/core/agents/agent-response-parser.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/core/api/prompts.ts src/core/agents/agent-response-parser.ts src/core/agents/agent-response-parser.test.ts
git commit -m "feat(prompts): document send_file tool and update response schemas"
```

---

### Task 5: Implement sendMedia in examples/whatsapp-bot with Baileys and Integration Test

**Files:**
- Modify: `examples/whatsapp-bot/src/index.ts`
- Create: `tests/core/whatsapp-media-integration.test.ts`

**Interfaces:**
- `sendMedia(chatId, media)` in Baileys bot supports video, image, document, size checks (16MB video threshold, 100MB max threshold).

- [ ] **Step 1: Write integration test**
Create `tests/core/whatsapp-media-integration.test.ts`:
- Full flow: `AgentActionExecutor` executes `send_file` -> `WhatsAppAdapter` receives `media_attachment` -> calls `transport.sendMedia` -> verifies payload for video (`.webm`), image (`.png`), and document (`.pdf`).

- [ ] **Step 2: Run integration test to verify it passes**
Run: `npx vitest run tests/core/whatsapp-media-integration.test.ts`
Expected: PASS.

- [ ] **Step 3: Implement sendMedia in examples/whatsapp-bot/src/index.ts**
In `examples/whatsapp-bot/src/index.ts`:
- Add `sendMedia` to the `transport` object.
- Implement size checks (< 16 MB video, < 100 MB document).
- Send via `sock.sendMessage`.

- [ ] **Step 4: Run full test suite**
Run: `npm test`
Expected: All tests pass.

- [ ] **Step 5: Commit**
```bash
git add examples/whatsapp-bot/src/index.ts tests/core/whatsapp-media-integration.test.ts
git commit -m "feat(whatsapp-bot): implement sendMedia driver with Baileys and integration tests"
```
