# Interactive /chat Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/chat` command to the interactive Shark Developer Agent shell (`shark dev`) to list, select, and resume existing conversation histories.

**Architecture:** 
1. Replace the local immutable constant `existingConversationId` in `interactiveDeveloperAgent` with a local mutable variable `activeConversationId` that holds the current session's active conversation ID.
2. In the `onCommandHandler` command hook, scan the `_sharkrc/history` directory for `.raw.json` and `.json` files, fetch metadata (timestamp, first user message content, associated agent name from `shark-workflow.json`), and present a selection dropdown using `tui.select`.
3. When selected, update `activeConversationId`, persist the switch using `conversationManager.saveConversationId`, and output the last 4 non-system messages with clear role colors.

**Tech Stack:** TypeScript, Commander.js, Node.js (fs, path), Vitest.

## Global Constraints
- Do not use TailwindCSS.
- All file paths must be absolute paths when reading or writing via tools.
- Maintain formatting and existing imports.

---

### Task 1: Implement the `/chat` command logic in `developer-agent.ts`

**Files:**
- Modify: [src/core/agents/developer-agent.ts](file:///d:/projetos/bmadspot/src/core/agents/developer-agent.ts)

**Interfaces:**
- Consumes: `HistoryManager` to retrieve raw histories. `workflowManager` to retrieve current workflow state for agent name mapping. `conversationManager` to persist the chosen conversation ID. `tui.select` for rendering the menu.

- [ ] **Step 1: Open the file and locate the imports and variable declarations**
  Check that `workflowManager` is imported or add it from `../workflow/workflow-manager.js`.
  ```typescript
  import { workflowManager } from '../workflow/workflow-manager.js';
  ```

- [ ] **Step 2: Modify the `interactiveDeveloperAgent` function signature and initial setup**
  Change the local `existingConversationId` constant to a `let activeConversationId` outside the `while (keepGoing)` loop:
  Replace:
  ```typescript
                  const existingConversationId = await conversationManager.getConversationId(conversationKey);
                  
                  if (existingConversationId) {
                      const rawHistory = await HistoryManager.getRawHistory(existingConversationId);
  ```
  with (placed before `while (keepGoing)`):
  ```typescript
      let activeConversationId = await conversationManager.getConversationId(conversationKey);
  ```
  And inside the `while (keepGoing)` loop, retrieve the raw history using `activeConversationId`:
  ```typescript
                  if (activeConversationId) {
                      const rawHistory = await HistoryManager.getRawHistory(activeConversationId);
  ```

- [ ] **Step 3: Update all references of `existingConversationId` to `activeConversationId`**
  Make sure all occurrences in `developer-agent.ts` (e.g. streaming the chat, compacting memory, checking total tokens) use `activeConversationId` instead of `existingConversationId`.
  And inside the response handler:
  ```typescript
                  if (response.conversation_id) {
                      activeConversationId = response.conversation_id;
                      await conversationManager.saveConversationId(conversationKey, response.conversation_id);
                  }
  ```

- [ ] **Step 4: Add the `/chat` command handling inside `onCommandHandler`**
  Add the command handler branch:
  ```typescript
          if (command === '/chat') {
              const historyDir = path.resolve(process.cwd(), '_sharkrc', 'history');
              if (fs.existsSync(historyDir)) {
                  const files = fs.readdirSync(historyDir);
                  const rawFiles = files.filter(f => f.endsWith('.raw.json') || f.endsWith('.json'));
                  const conversationIds = Array.from(new Set(rawFiles.map(f => f.replace('.raw.json', '').replace('.json', ''))));

                  if (conversationIds.length === 0) {
                      tui.log.warning('Nenhuma conversa encontrada em _sharkrc/history.');
                      return true;
                  }

                  const state = await workflowManager.load();
                  const conversationsMap = state?.conversations || {};
                  const idToAgentMap: Record<string, string> = {};
                  for (const [key, id] of Object.entries(conversationsMap)) {
                      if (typeof id === 'string') {
                          idToAgentMap[id] = key;
                      }
                  }

                  const items = [];
                  for (const id of conversationIds) {
                      const rawPath = path.resolve(historyDir, `${id}.raw.json`);
                      const jsonPath = path.resolve(historyDir, `${id}.json`);
                      const filePath = fs.existsSync(rawPath) ? rawPath : jsonPath;

                      try {
                          const stats = fs.statSync(filePath);
                          const content = fs.readFileSync(filePath, 'utf-8');
                          const messages = JSON.parse(content);
                          if (Array.isArray(messages)) {
                              const firstUser = messages.find((m: any) => m.role === 'user')?.content || '';
                              const agentKey = idToAgentMap[id] || 'standalone';
                              items.push({
                                  id,
                                  agentKey,
                                  mtime: stats.mtime,
                                  firstUser
                              });
                          }
                      } catch {}
                  }

                  items.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

                  const options = items.map(item => {
                      const shortId = item.id.substring(0, 8);
                      const dateStr = item.mtime.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' + item.mtime.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                      const snippet = item.firstUser.replace(/\n/g, ' ').substring(0, 60);
                      const topic = snippet ? ` | Assunto: "${snippet}"` : '';
                      return {
                          value: item.id,
                          label: `[${shortId}...] (${item.agentKey}) | ${dateStr}${topic}`
                      };
                  });

                  const selectedId = await tui.select({
                      message: 'Selecione a conversa para carregar:',
                      options
                  });

                  if (!tui.isCancel(selectedId) && selectedId) {
                      activeConversationId = selectedId as string;
                      await conversationManager.saveConversationId(conversationKey, activeConversationId);
                      tui.log.success(`✔ Alternado para a conversa: ${activeConversationId.substring(0, 8)}...`);

                      const rawHistory = await HistoryManager.getRawHistory(activeConversationId);
                      const nonSystem = rawHistory.filter(m => m.role !== 'system');
                      const lastMsgs = nonSystem.slice(-4);

                      tui.log.info(colors.dim('\n--- HISTÓRICO RECENTE ---'));
                      for (const msg of lastMsgs) {
                          const sender = msg.role === 'user' ? colors.warning('👤 [Você]') : colors.primary('🤖 [Shark Dev]');
                          const text = msg.content.substring(0, 300) + (msg.content.length > 300 ? '...' : '');
                          console.log(`${sender}: ${text}`);
                      }
                      tui.log.info(colors.dim('------------------------\n'));
                  }
              } else {
                  tui.log.warning('Diretório de histórico não encontrado.');
              }
              return true;
          }
  ```

---

### Task 2: Write unit tests in `developer-agent.test.ts`

**Files:**
- Modify: [src/core/agents/developer-agent.test.ts](file:///d:/projetos/bmadspot/src/core/agents/developer-agent.test.ts)

- [ ] **Step 1: Write a unit test verifying the `/chat` command flow**
  Add a new test case inside `describe('DeveloperAgent')`:
  ```typescript
      it('should handle /chat command, list conversations and switch conversation key', async () => {
          // Mock fs module and path reading
          const fsMock = await import('node:fs');
          const existsSpy = vi.spyOn(fsMock, 'existsSync').mockReturnValue(true);
          const readdirSpy = vi.spyOn(fsMock, 'readdirSync').mockReturnValue([
              'test-convo-123.raw.json' as any
          ]);
          const statSpy = vi.spyOn(fsMock, 'statSync').mockReturnValue({
              mtime: new Date('2026-07-16T12:00:00Z')
          } as any);
          const readSpy = vi.spyOn(fsMock, 'readFileSync').mockReturnValue(
              JSON.stringify([
                  { role: 'system', content: 'system instructions' },
                  { role: 'user', content: 'hello agent' },
                  { role: 'assistant', content: 'hello user' }
              ])
          );

          const { workflowManager } = await import('../workflow/workflow-manager.js');
          vi.mock('../workflow/workflow-manager.js', () => ({
              workflowManager: {
                  load: vi.fn().mockResolvedValue({
                      conversations: {
                          developer_agent: 'test-convo-123'
                      }
                  }),
                  save: vi.fn().mockResolvedValue(undefined)
              }
          }));

          const getRawHistorySpy = vi.spyOn(HistoryManager, 'getRawHistory').mockResolvedValue([
              { role: 'system', content: 'system instructions' },
              { role: 'user', content: 'hello agent' },
              { role: 'assistant', content: 'hello user' }
          ]);

          vi.mocked(tui.text)
              .mockResolvedValueOnce('/chat')
              .mockResolvedValueOnce('cancel'); // cancel prompt loop after command

          vi.mocked(tui.select).mockResolvedValueOnce('test-convo-123');
          vi.mocked(tui.isCancel).mockReturnValue(false);

          await interactiveDeveloperAgent({
              taskInstruction: undefined,
              auto: false
          });

          expect(tui.select).toHaveBeenCalled();
          expect(conversationManager.saveConversationId).toHaveBeenCalledWith(
              expect.any(String),
              'test-convo-123'
          );

          existsSpy.mockRestore();
          readdirSpy.mockRestore();
          statSpy.mockRestore();
          readSpy.mockRestore();
          getRawHistorySpy.mockRestore();
      });
  ```

- [ ] **Step 2: Run all tests to make sure everything passes**
  Run: `npm run test` or `npx vitest run`
  Expected: PASS

- [ ] **Step 3: Commit all changes**
  ```bash
  git add src/core/agents/developer-agent.ts src/core/agents/developer-agent.test.ts
  git commit -m "feat: add interactive /chat command to switch conversations"
  ```
