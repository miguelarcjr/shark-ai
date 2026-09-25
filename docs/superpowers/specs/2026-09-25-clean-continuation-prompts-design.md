# Design Spec: Clean Continuation Prompts in Multi-Turn Agent Engine

- **Date:** 2026-09-25
- **Author:** Shark AI Team
- **Status:** Approved

---

## 1. Problem Statement

In the Shark AI agent engine:
- In CLI interactive mode (`shark dev`), the turn loop runs continuously in `TurnLoopRunner`. The first turn receives a wrapped `basePrompt` containing `--- PROJECT CONTEXT ---` and `🟢 EXECUTION MODE`. When the agent converses via `talk_with_user`, the user's reply in the terminal is passed directly as raw text (`currentPrompt = nextMsg.content`) without any boilerplate wrapper.
- In adapter/channel integrations (such as the WhatsApp Bot in `examples/whatsapp-bot`), every inbound message is handled asynchronously via `AgentEngine.processMessage(message)`. This method invokes `runInteractive({ taskInstruction: message.text, auto: true })` for each message.
- Consequently, `EngineContextBuilder.prepare()` is executed on every inbound message, reconstructing `buildBasePrompt` with the full `🟢 EXECUTION MODE`, `--- PROJECT CONTEXT ---`, and repetitive execution instructions.
- Over multiple turns in the same conversation session, the conversation history accumulates dozens of identical `🟢 EXECUTION MODE` headers, inflating token usage and causing repetitive or disjointed responses from the model.

---

## 2. Goals & Non-Goals

### Goals
- Ensure that only the initial turn of a session/conversation receives the `🟢 EXECUTION MODE` header and `--- PROJECT CONTEXT ---` boilerplate.
- For all subsequent turns within the same active conversation session (history length > 0), feed the user's message as clean, natural text, exactly mirroring the CLI behavior.
- Keep the logic centralized in `EngineContextBuilder` so all adapters (CLI, WhatsApp, future channels) benefit automatically.
- Ensure automated unit tests validate both initial turn and continuation turns.

### Non-Goals
- Altering the behavior or prompt formatting of isolated subagents (`subagent-*`).
- Keeping persistent background worker threads open per session for idle adapters.

---

## 3. Architecture & Technical Design

### 3.1 History Check in `EngineContextBuilder`

In [`src/core/engine/engine-context-builder.ts`](file:///d:/projetos/bmadspot/src/core/engine/engine-context-builder.ts):

1. After resolving `activeConversationId` from `conversationKey`:
   ```typescript
   let hasExistingHistory = false;
   if (activeConversationId) {
       const existingHistory = await HistoryManager.getRawHistory(activeConversationId);
       hasExistingHistory = Array.isArray(existingHistory) && existingHistory.length > 0;
   }
   ```

2. When constructing `buildBasePrompt`:
   ```typescript
   const buildBasePrompt = (instruction: string) => {
       // Se já houver histórico acumulado nesta conversa (continuação de diálogo),
       // envia apenas a instrução limpa, assim como o CLI interativo faz
       if (hasExistingHistory && !isSubagent) {
           return instruction || '';
       }

       let prompt = '';
       if (contextContent) {
           prompt += `\n\n--- PROJECT CONTEXT ---\n${contextContent}\n-----------------------\n`;
       }
       if (options.history) {
           prompt += `\n\n--- PREVIOUS EXECUTION SUMMARY ---\n${options.history}\n----------------------------------\n`;
       }
       prompt += `\n\n🟢 EXECUTION MODE\n...`;
       return prompt;
   };
   ```

### 3.2 Dynamic Instruction Updates

`PreparedEngineContext` exposes `setTaskInstruction(instruction: string)`.
When updated, `buildBasePrompt(instruction)` respects the `hasExistingHistory` flag, ensuring consistency if instructions are dynamically updated mid-preparation.

---

## 4. Verification & Testing

### 4.1 Unit Tests
Create or update tests in [`src/core/engine/engine-context-builder.test.ts`](file:///d:/projetos/bmadspot/src/core/engine/engine-context-builder.test.ts):
1. **Turn 1 (Empty History)**: Verify that `basePrompt` contains `🟢 EXECUTION MODE` and `--- PROJECT CONTEXT ---`.
2. **Turn 2+ (Existing History)**: Mock `HistoryManager.getRawHistory` returning `[{ role: 'user', content: 'hello' }]`. Verify that `basePrompt` equals the raw instruction text without `🟢 EXECUTION MODE`.
3. **Subagent Exclusion**: Ensure subagents still receive their structured task prompt even if there is pre-existing history for that task key.

### 4.2 Regression Testing
Run `npx vitest run src/core/engine` to verify existing tests continue to pass.
