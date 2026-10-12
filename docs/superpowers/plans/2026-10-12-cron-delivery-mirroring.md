# Cron Delivery Mirroring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Delivery Mirroring and In-Memory Consecutive-User Merge for scheduled cronjobs in Shark AI, eliminating notification amnesia across chat sessions (WhatsApp, Telegram, CLI).

**Architecture:** Extend `CronJob` and `CronToolArgs` with `attach_to_session`. Build a dedicated `CronDeliveryMirror` component to format notifications (`[Cron delivery: <name>]`) and persist them with `role: 'user'` into SQLite `StateDB` and `HistoryManager`. Add an in-memory `mergeConsecutiveRoles` normalizer to LLM providers to strictly maintain role alternation without breaking API payloads.

**Tech Stack:** TypeScript, Node.js (`node:sqlite` DatabaseSync), Vitest.

## Global Constraints

- Do not modify existing SQLite table schemas (`messages`, `messages_fts`); use existing `recordMessage`.
- Notifications MUST be stored with `role: 'user'` (never `assistant`), marked with `[Cron delivery: <nome>]`.
- Consecutive user messages MUST be merged exclusively in-memory during LLM request assembly via `mergeConsecutiveRoles`.
- All tests MUST pass via Vitest (`npx vitest run`).
- Frequent atomic git commits after each task.

---

### Task 1: Data Model and Tool Arguments Extension

**Files:**
- Modify: `src/core/cron/cron-types.ts:1-54`
- Modify: `src/core/cron/cron-tool-handler.ts:50-130`
- Modify: `src/core/agents/action-validator.ts:159-165`
- Modify: `src/core/api/prompts.ts:90-100`
- Test: `src/core/cron/cron-tool-handler.test.ts`

**Interfaces:**
- Consumes: `CronJob`, `CronToolArgs` from `src/core/cron/cron-types.ts`
- Produces: `attach_to_session?: boolean` on `CronJob` and `CronToolArgs`

- [ ] **Step 1: Write the failing test**

In `src/core/cron/cron-tool-handler.test.ts`, add test cases asserting `attach_to_session` handling:
```typescript
it('should default attach_to_session to true when deliver is origin or omitted', async () => {
    const handler = new CronToolHandler({ storage });
    const res = await handler.handleAction({
        action: 'create',
        schedule: '10m',
        prompt: 'test prompt',
        deliver: 'origin'
    });
    expect(res.success).toBe(true);
    expect(res.job?.attach_to_session).toBe(true);
});

it('should default attach_to_session to false for third party deliver unless explicit', async () => {
    const handler = new CronToolHandler({ storage });
    const res = await handler.handleAction({
        action: 'create',
        schedule: '10m',
        prompt: 'test prompt',
        deliver: 'whatsapp:12345'
    });
    expect(res.success).toBe(true);
    expect(res.job?.attach_to_session).toBe(false);

    const resExplicit = await handler.handleAction({
        action: 'create',
        schedule: '10m',
        prompt: 'test prompt',
        deliver: 'whatsapp:12345',
        attach_to_session: true
    });
    expect(resExplicit.job?.attach_to_session).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/cron/cron-tool-handler.test.ts`
Expected: FAIL due to missing property or incorrect assertion

- [ ] **Step 3: Update `cron-types.ts`, `cron-tool-handler.ts`, `action-validator.ts`, and `prompts.ts`**

In `src/core/cron/cron-types.ts`:
Add `attach_to_session?: boolean;` to both `CronJob` and `CronToolArgs`.

In `src/core/cron/cron-tool-handler.ts`:
In `createJob`:
```typescript
const isOrigin = !args.deliver || args.deliver === 'origin';
const attachToSession = args.attach_to_session !== undefined ? args.attach_to_session : isOrigin;
```
Assign `attach_to_session: attachToSession` to `newJob`.
In `updateJob`:
```typescript
if (args.attach_to_session !== undefined) job.attach_to_session = args.attach_to_session;
```

In `src/core/agents/action-validator.ts`:
Add `'attach_to_session'` to `optional` fields of `cronjob`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/cron/cron-tool-handler.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/cron/cron-types.ts src/core/cron/cron-tool-handler.ts src/core/cron/cron-tool-handler.test.ts src/core/agents/action-validator.ts src/core/api/prompts.ts
git commit -m "feat(cron): add attach_to_session field to cronjob model and handler"
```

---

### Task 2: In-Memory Consecutive Role Normalizer (`mergeConsecutiveRoles`)

**Files:**
- Modify: `src/core/workflow/history-manager.ts:1-25`
- Modify: `src/core/api/openai-compatible-provider.ts:180-210`
- Modify: `src/core/api/stackspot-provider.ts:120-150`
- Test: `src/core/workflow/history-manager.test.ts`

**Interfaces:**
- Consumes: `ChatMessage` from `src/core/workflow/history-manager.ts`
- Produces: `export function mergeConsecutiveRoles(messages: ChatMessage[]): ChatMessage[]`

- [ ] **Step 1: Write the failing test**

In `src/core/workflow/history-manager.test.ts`, add a `describe('mergeConsecutiveRoles')` block:
```typescript
import { mergeConsecutiveRoles } from './history-manager.js';

describe('mergeConsecutiveRoles', () => {
    it('should merge consecutive user messages with double newline separator', () => {
        const input: ChatMessage[] = [
            { role: 'system', content: 'sys' },
            { role: 'user', content: '[Cron delivery: Daily Report]\nDone.' },
            { role: 'user', content: 'What is the next step?' }
        ];
        const result = mergeConsecutiveRoles(input);
        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({ role: 'system', content: 'sys' });
        expect(result[1]).toEqual({
            role: 'user',
            content: '[Cron delivery: Daily Report]\nDone.\n\nWhat is the next step?'
        });
    });

    it('should keep already alternating roles unchanged', () => {
        const input: ChatMessage[] = [
            { role: 'user', content: 'Hello' },
            { role: 'assistant', content: 'Hi' },
            { role: 'user', content: 'Help' }
        ];
        const result = mergeConsecutiveRoles(input);
        expect(result).toEqual(input);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/workflow/history-manager.test.ts`
Expected: FAIL with "mergeConsecutiveRoles is not defined"

- [ ] **Step 3: Implement `mergeConsecutiveRoles` and integrate in providers**

In `src/core/workflow/history-manager.ts`:
```typescript
export function mergeConsecutiveRoles(messages: ChatMessage[]): ChatMessage[] {
    const result: ChatMessage[] = [];
    for (const msg of messages) {
        if (!msg || !msg.content) continue;
        if (result.length > 0 && result[result.length - 1].role === msg.role) {
            result[result.length - 1] = {
                ...result[result.length - 1],
                content: `${result[result.length - 1].content}\n\n${msg.content}`
            };
        } else {
            result.push({ ...msg });
        }
    }
    return result;
}
```

In `src/core/api/openai-compatible-provider.ts`:
Import `mergeConsecutiveRoles`.
In `streamChat()`, apply `mergeConsecutiveRoles` to the conversation history before adding to `requestMessages`.

In `src/core/api/stackspot-provider.ts`:
Import `mergeConsecutiveRoles`.
Apply `mergeConsecutiveRoles` to `historyCopy` when preparing `compiledPrompt`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/core/workflow/history-manager.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/workflow/history-manager.ts src/core/workflow/history-manager.test.ts src/core/api/openai-compatible-provider.ts src/core/api/stackspot-provider.ts
git commit -m "feat(workflow): implement mergeConsecutiveRoles to normalize adjacent turns in memory"
```

---

### Task 3: Delivery Mirroring Component (`CronDeliveryMirror`)

**Files:**
- Create: `src/core/cron/cron-delivery-mirror.ts`
- Modify: `src/core/cron/index.ts`
- Test: `src/core/cron/cron-delivery-mirror.test.ts`

**Interfaces:**
- Consumes: `CronJob` from `src/core/cron/cron-types.ts`, `StateDB` from `src/core/memory/state-db.ts`, `HistoryManager` from `src/core/workflow/history-manager.ts`, `conversationManager` from `src/core/workflow/conversation-manager.ts`
- Produces: `CronDeliveryMirror.mirrorToSession(options: MirrorDeliveryOptions): Promise<boolean>`

- [ ] **Step 1: Write the failing test**

Create `src/core/cron/cron-delivery-mirror.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { CronDeliveryMirror } from './cron-delivery-mirror.js';
import type { CronJob } from './cron-types.js';
import { StateDB } from '../memory/state-db.js';

describe('CronDeliveryMirror', () => {
    const baseJob: CronJob = {
        id: 'job-123',
        name: 'Daily Audit',
        schedule: 'every 1h',
        status: 'scheduled',
        deliver: 'origin',
        origin_channel: 'whatsapp',
        origin_recipient_id: 'user_999',
        created_at: Date.now(),
        next_run_at: Date.now() + 3600000,
        run_count: 1
    };

    it('should mirror to state.db when delivery succeeds and deliver is origin', async () => {
        const mirrored = await CronDeliveryMirror.mirrorToSession({
            job: baseJob,
            deliveredText: 'Audit finished successfully.',
            deliverySuccess: true
        });
        expect(mirrored).toBe(true);

        const stateDb = new StateDB();
        const results = stateDb.search('Audit finished');
        stateDb.close();
        expect(results.length).toBeGreaterThan(0);
        expect(results[0].content).toContain('[Cron delivery: Daily Audit]');
        expect(results[0].role).toBe('user');
    });

    it('should suppress mirroring when deliveredText contains [SILENT]', async () => {
        const mirrored = await CronDeliveryMirror.mirrorToSession({
            job: baseJob,
            deliveredText: '[SILENT] No change detected',
            deliverySuccess: true
        });
        expect(mirrored).toBe(false);
    });

    it('should suppress mirroring when deliverySuccess is false', async () => {
        const mirrored = await CronDeliveryMirror.mirrorToSession({
            job: baseJob,
            deliveredText: 'Failed to send',
            deliverySuccess: false
        });
        expect(mirrored).toBe(false);
    });

    it('should suppress mirroring when deliver is local or all', async () => {
        const localJob = { ...baseJob, deliver: 'local' };
        const mirroredLocal = await CronDeliveryMirror.mirrorToSession({
            job: localJob,
            deliveredText: 'Report generated',
            deliverySuccess: true
        });
        expect(mirroredLocal).toBe(false);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/cron/cron-delivery-mirror.test.ts`
Expected: FAIL with "Cannot find module './cron-delivery-mirror.js'"

- [ ] **Step 3: Implement `CronDeliveryMirror`**

Create `src/core/cron/cron-delivery-mirror.ts`:
Implement `CronDeliveryMirror.mirrorToSession`:
- Check `deliverySuccess` guard.
- Check `[SILENT]` / `NO_REPLY` guard.
- Check `job.deliver === 'local' || job.deliver === 'all'` guard.
- Check eligibility: `job.deliver === 'origin' || job.attach_to_session === true`.
- Determine `sessionId = originChannel === 'cli' ? 'default' : `${originChannel}:dm:${recipientId}``.
- Format message: `[Cron delivery: ${job.name || job.id}]\n${deliveredText}`.
- Record in `StateDB` with `role: 'user'`.
- Record in `HistoryManager` if `conversationId` found via `conversationManager`.

Export `CronDeliveryMirror` in `src/core/cron/index.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/cron/cron-delivery-mirror.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/cron/cron-delivery-mirror.ts src/core/cron/cron-delivery-mirror.test.ts src/core/cron/index.ts
git commit -m "feat(cron): add CronDeliveryMirror component with eligibility and atomic persistence"
```

---

### Task 4: Integration with `AgentEngine.deliverCronResult`

**Files:**
- Modify: `src/core/engine/agent-engine.ts:121-180`
- Test: `src/core/engine/agent-engine.test.ts`

**Interfaces:**
- Consumes: `CronDeliveryMirror` from `../cron/cron-delivery-mirror.js`
- Produces: `deliverCronResult` calling `CronDeliveryMirror.mirrorToSession` upon adapter success

- [ ] **Step 1: Write the failing test**

In `src/core/engine/agent-engine.test.ts`, add a test verifying that `deliverCronResult` triggers `CronDeliveryMirror`:
```typescript
it('should mirror delivered cron result to session when adapter emits successfully', async () => {
    const job: CronJob = {
        id: 'job-test-mirror',
        schedule: '10m',
        status: 'scheduled',
        deliver: 'origin',
        origin_channel: 'cli',
        origin_recipient_id: 'local',
        created_at: Date.now(),
        next_run_at: Date.now() + 600000,
        run_count: 1
    };
    const result: ExecutorRunResult = {
        success: true,
        output: 'Deployment completed cleanly.',
        silent: false
    };

    await engine.deliverCronResult(job, result);

    const stateDb = new StateDB();
    const matches = stateDb.search('Deployment completed cleanly');
    stateDb.close();
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].role).toBe('user');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/engine/agent-engine.test.ts`
Expected: FAIL (no record found in `stateDb`)

- [ ] **Step 3: Update `AgentEngine.deliverCronResult`**

In `src/core/engine/agent-engine.ts`:
Import `CronDeliveryMirror` from `../cron/cron-delivery-mirror.js`.
In `deliverCronResult`:
Track `let deliverySuccess = false`.
Set `deliverySuccess = true` after successful emission (`targetAdapter.emit` or `tui.log.info`).
If `deliverySuccess`:
```typescript
await CronDeliveryMirror.mirrorToSession({
    job,
    deliveredText: messageText,
    deliverySuccess: true,
    projectRoot: this.projectRoot
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/engine/agent-engine.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/engine/agent-engine.ts src/core/engine/agent-engine.test.ts
git commit -m "feat(engine): connect deliverCronResult to CronDeliveryMirror"
```

---

### Task 5: Full Regression and End-to-End Suite Verification

**Files:**
- Test: All test files in `src/`

- [ ] **Step 1: Run complete test suite**

Run: `npm test` or `npx vitest run`
Expected: 100% tests passing, zero regressions in existing cron, workflow, or engine suites.

- [ ] **Step 2: Verify git status and clean working tree**

Run: `git status`
Expected: Working tree clean.

- [ ] **Step 3: Commit final plan documentation**

```bash
git add docs/superpowers/plans/2026-10-12-cron-delivery-mirroring.md
git commit -m "docs: add implementation plan for cron delivery mirroring"
```
