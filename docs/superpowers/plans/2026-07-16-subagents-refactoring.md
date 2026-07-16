# Refatoração da Orquestração de Subagentes - Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refatorar a orquestração e a comunicação de subagentes para resolver bugs críticos de deadlocks, zumbis, incompatibilidades de schema e fallbacks incorretos.

**Architecture:** Modificar o parser de briefings no `SubagentManager` para usar YAML Frontmatter, implementar pooling ativo da mailbox em background usando timers no loop do coordenador, usar o sinal IPC `disconnect` para impedir processos órfãos nos subagentes, e aplicar tratamentos estritos nos fallbacks de parsing.

**Tech Stack:** TypeScript, Node.js (`child_process`), Vitest, Zod.

## Global Constraints
- Manter compatibilidade com Node.js >= 20.0.0.
- Evitar dependências externas de terceiros; utilizar regex nativo para parsing de Frontmatter.
- Escrever testes primeiro (TDD) para cada alteração funcional.

---

### Task 1: Parser de YAML Frontmatter e Handoff de `task_file`

**Files:**
- Modify: `src/core/workflow/subagent-manager.ts`
- Modify: `src/core/agents/developer-agent.ts`
- Test: `src/core/workflow/subagent-manager.test.ts`
- Test: `src/core/agents/developer-agent.test.ts`

**Interfaces:**
- Consumes: `action.task_file` do JSON de resposta do Coordenador.
- Produces: `subagentManager.parseTaskBrief(filePath: string): { type: string, role: string, prompt: string }`

- [ ] **Step 1: Escrever teste de unidade para `parseTaskBrief`**
  Em `src/core/workflow/subagent-manager.test.ts`, adicionar um teste garantindo que o parser lê corretamente o frontmatter e o prompt, bem como falha no formato inválido.

  ```typescript
  describe('parseTaskBrief', () => {
      it('should parse valid frontmatter and return metadata and body', () => {
          const filePath = path.resolve(process.cwd(), 'test-brief.md');
          fs.writeFileSync(filePath, '---\ntype: developer_agent\nrole: Reviewer\n---\n# Prompt\nExecute review', 'utf-8');
          
          const result = (subagentManager as any).parseTaskBrief(filePath);
          expect(result).toEqual({
              type: 'developer_agent',
              role: 'Reviewer',
              prompt: '# Prompt\nExecute review'
          });
          fs.unlinkSync(filePath);
      });

      it('should throw error for invalid frontmatter', () => {
          const filePath = path.resolve(process.cwd(), 'test-brief-invalid.md');
          fs.writeFileSync(filePath, 'no frontmatter here', 'utf-8');
          
          expect(() => (subagentManager as any).parseTaskBrief(filePath)).toThrow();
          fs.unlinkSync(filePath);
      });
  });
  ```

- [ ] **Step 2: Rodar o teste e verificar que falha**
  Executar: `npx vitest run src/core/workflow/subagent-manager.test.ts`
  Resultado esperado: FAIL com erro indicando que `parseTaskBrief` não é uma função.

- [ ] **Step 3: Implementar a função `parseTaskBrief` em `src/core/workflow/subagent-manager.ts`**
  Adicionar o método privado na classe `SubagentManager`:

  ```typescript
  parseTaskBrief(filePath: string): { type: string, role: string, prompt: string } {
      if (!fs.existsSync(filePath)) {
          throw new Error(`Briefing file not found at ${filePath}`);
      }
      const content = fs.readFileSync(filePath, 'utf-8');
      const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
      if (!match) {
          throw new Error('Briefing file does not contain valid YAML frontmatter delimiters (---)');
      }
      const yamlStr = match[1];
      const prompt = match[2].trim();

      const lines = yamlStr.split('\n');
      let type = '';
      let role = '';
      for (const line of lines) {
          const parts = line.split(':');
          if (parts.length >= 2) {
              const key = parts[0].trim();
              const value = parts.slice(1).join(':').trim();
              if (key === 'type') type = value;
              if (key === 'role') role = value;
          }
      }

      if (!type || !role) {
          throw new Error('Briefing YAML frontmatter must define both "type" and "role" properties');
      }

      return { type, role, prompt };
  }
  ```

- [ ] **Step 4: Rodar o teste e verificar que passa**
  Executar: `npx vitest run src/core/workflow/subagent-manager.test.ts`
  Resultado esperado: PASS.

- [ ] **Step 5: Refatorar `invoke_subagent` em `src/core/agents/developer-agent.ts` para usar `task_file`**
  Modificar a manipulação de `action.type === 'invoke_subagent'` para:

  ```typescript
                else if (action.type === 'invoke_subagent') {
                    const taskFile = action.task_file;
                    if (!taskFile) {
                        throw new Error('Action invoke_subagent requires "task_file" parameter');
                    }
                    const resolvedPath = path.resolve(process.cwd(), taskFile);
                    log.info(`🚀 Invoking subagent from brief: ${resolvedPath}`);
                    const parsed = subagentManager.parseTaskBrief(resolvedPath);
                    const parentId = options.taskId || 'parent';
                    const invoked = await subagentManager.invokeSubagents(
                        [{ TypeName: parsed.type, Role: parsed.role, Prompt: parsed.prompt }],
                        parentId,
                        messageQueue
                    );
                    resultMsg = `[Action invoke_subagent Success]: Invoked subagent:\n${invoked.map(s => `- ID: ${s.id}, Type: ${s.TypeName}, Role: ${s.Role}`).join('\n')}`;
                }
  ```

- [ ] **Step 6: Atualizar schemas e prompts e rodar todos os testes de unidade**
  Modificar `src/core/api/prompts.ts` para remover `Subagents` e `subagents` do schema do coordenador. Rodar `npx vitest run` e certificar-se de que passa.

- [ ] **Step 7: Commit**
  ```bash
  git add src/core/workflow/subagent-manager.ts src/core/agents/developer-agent.ts src/core/api/prompts.ts src/core/workflow/subagent-manager.test.ts
  git commit -m "feat: implement task_file frontmatter parser for subagents"
  ```

---

### Task 2: Polling Ativo da Mailbox e Acknowledgment (Ack)

**Files:**
- Modify: `src/core/agents/developer-agent.ts`
- Modify: `src/core/workflow/subagent-manager.ts`
- Test: `src/core/agents/developer-agent.test.ts`

**Interfaces:**
- Consumes: Arquivos em `.shark/mailbox/<recipient>/` em tempo de execução.
- Produces: Push automático de mensagens no `MessageQueue` do Coordenador. Renomear arquivos para `.json.processed` após consumo.

- [ ] **Step 1: Modificar `subagent-manager.ts` para renomear em vez de excluir**
  Alterar `retrieveMessages` para usar renomeação ao invés de exclusão direta:
  ```typescript
      retrieveMessages(id: string): string[] {
          const mailboxDir = path.resolve(process.cwd(), '.shark', 'mailbox', id);
          if (!fs.existsSync(mailboxDir)) {
              return [];
          }
          const files = fs.readdirSync(mailboxDir).filter(f => !f.endsWith('.processed'));
          files.sort();
          const messages: string[] = [];
          for (const file of files) {
              const filePath = path.join(mailboxDir, file);
              try {
                  const content = fs.readFileSync(filePath, 'utf-8');
                  const data = JSON.parse(content);
                  if (data && typeof data.message === 'string') {
                      messages.push(data.message);
                  }
              } catch (e) {
                  // Ignore read/parse errors
              }
              try {
                  // Rename to .processed (Ack) with Windows retry safety
                  const destPath = filePath + '.processed';
                  let retries = 3;
                  while (retries > 0) {
                      try {
                          fs.renameSync(filePath, destPath);
                          break;
                      } catch (err) {
                          retries--;
                          if (retries === 0) throw err;
                          // small pause for Windows locks
                          const waitTill = new Date(new Date().getTime() + 50);
                          while (waitTill > new Date()) {}
                      }
                  }
              } catch (e) {
                  // Ignore rename errors but delete as fallback if rename fails persistently
                  try { fs.unlinkSync(filePath); } catch {}
              }
          }
          return messages;
      }
  ```

- [ ] **Step 2: Escrever teste de unidade para polling ativo da mailbox**
  Em `src/core/agents/developer-agent.test.ts`, escrever teste simulando que uma mensagem de mailbox colocada enquanto o coordenador está esperando faz o loop acordar.

- [ ] **Step 3: Implementar o timer de polling ativo em `developer-agent.ts`**
  No início do método `interactiveDeveloperAgent` (perto da inicialização da fila e do loop principal):
  ```typescript
      let mailboxInterval: NodeJS.Timeout | null = null;
      if (options.taskId || !isSubagent) {
          const myId = options.taskId || 'parent';
          mailboxInterval = setInterval(() => {
              try {
                  const newMsgs = subagentManager.retrieveMessages(myId);
                  for (const msg of newMsgs) {
                      // Wrap in XML tag structure to prevent prompt injection
                      const formatted = `<mailbox>\n  <message from="subagent" status="info">\n${msg}\n  </message>\n</mailbox>`;
                      messageQueue.push({
                          type: 'subagent_notification',
                          content: formatted,
                          timestamp: Date.now()
                      });
                  }
              } catch (e) {
                  // Ignore error during background polling
              }
          }, 2000);
      }
  ```
  E certificar-se de limpar no `finally`:
  ```typescript
      } finally {
          if (mailboxInterval) {
              clearInterval(mailboxInterval);
          }
          // rest of finally block...
      }
  ```

- [ ] **Step 4: Rodar testes e verificar que passam**
  Executar: `npx vitest run src/core/agents/developer-agent.test.ts`

- [ ] **Step 5: Commit**
  ```bash
  git add src/core/agents/developer-agent.ts src/core/workflow/subagent-manager.ts
  git commit -m "feat: implement active mailbox polling and message Ack"
  ```

---

### Task 3: Prevenção de Zumbis e Resiliência contra Crashes/Falhas

**Files:**
- Modify: `src/core/agents/developer-agent.ts`
- Modify: `src/core/workflow/subagent-manager.ts`

**Interfaces:**
- Consumes: Sinal IPC `disconnect` e evento `child.on('exit')` / `child.on('error')`.
- Produces: Auto-encerramento do subagente e logs de stderr expostos ao pai.

- [ ] **Step 1: Escutar `disconnect` no subagente em `developer-agent.ts`**
  Adicionar a lógica no início de `interactiveDeveloperAgent` (ou onde o processo do subagente inicia):
  ```typescript
      if (isSubagent && process.send) {
          process.on('disconnect', () => {
              log.warning('Parent process disconnected. Exiting to prevent zombie process...');
              process.exit(1);
          });
      }
  ```

- [ ] **Step 2: Implementar fallback de logs e silêncio no `SubagentManager` em `subagent-manager.ts`**
  No método `invokeSubagents`, atualizar a manipulação do encerramento do processo:
  ```typescript
                     // No evento 'exit' do child
                     const logStream = fs.createWriteStream(consoleLogFile, { flags: 'a' });
                     // ... pipe streams ...
                     
                     child.on('error', (err) => {
                         this.updateSubagentSummary(id, `Spawn Error: ${err.message}`);
                         this.sendMessage(parentId, `[Subagent Notification] Subagent ${sub.Role} (${id}) failed to start. Error: ${err.message}`);
                     });
  ```
  E no fluxo de saída de `success` e `!success`:
  ```typescript
                     if (!success) {
                         const lastLogs = this.getSubagentLogs(id, 15);
                         const fallbackMsg = `[Subagent Notification] Subagent ${sub.Role} (${id}) failed (Exit Code: ${exitCode}). Last console logs:\n${lastLogs}`;
                         this.sendMessage(parentId, fallbackMsg);
                     } else {
                         // Se terminou com 0 mas sem mensagens na mailbox
                         const parentMsgs = this.peekMessages(parentId);
                         const subagentMsg = parentMsgs.find(m => m.includes(`(${id})`));
                         if (!subagentMsg) {
                             const completedMsg = `[Subagent Notification] Subagent ${sub.Role} (${id}) completed successfully but did not return detailed results.`;
                             this.sendMessage(parentId, completedMsg);
                         }
                     }
  ```

- [ ] **Step 3: Corrigir o Path do CLI `shark.js`**
  Ajustar o método `invokeSubagents` para tentar localizar o binário e, caso a escalada falhe ou fique sem `package.json`, usar `path.resolve(packageRoot, 'dist', 'bin', 'shark.js')` com fallback de segurança.

- [ ] **Step 4: Executar testes de unidade de spawn e erro**
  Garantir que todos os testes passem: `npm test`

- [ ] **Step 5: Commit**
  ```bash
  git add src/core/agents/developer-agent.ts src/core/workflow/subagent-manager.ts
  git commit -m "feat: implement zombie prevention and crash logs extraction"
  ```

---

### Task 4: Tratamento estrito de Fallbacks, Identidade e Alinhamentos de Schema

**Files:**
- Modify: `src/core/agents/developer-agent.ts`
- Modify: `src/core/api/prompts.ts`
- Modify: `src/core/agents/agent-response-parser.ts`
- Test: `src/core/agents/developer-agent.test.ts`

**Interfaces:**
- Consumes: Ações tratadas no parser e regras de schema do subagente.
- Produces: Resoluções sem falsos positivos de conclusão ao deparar com erros de formato.

- [ ] **Step 1: Diferenciar erro sintético de talk_with_user em `agent-response-parser.ts`**
  Se a resposta do agente cair em fallback de parse/texto puro ou em erro de JSON incompleto, adicionar uma propriedade de controle no retorno do parser para sabermos que a ação `talk_with_user` é sintética:
  ```typescript
  // Em agent-response-parser.ts, no retorno do parser de fallback:
  return {
      action: {
          type: 'talk_with_user',
          content: rawResponse,
          path: '',
          isSynthetic: true // Campo opcional
      },
      ...
  }
  ```

- [ ] **Step 2: Impedir falsos positivos em `developer-agent.ts`**
  No bloco `else if (action.type === 'talk_with_user')` do loop de execução em `developer-agent.ts`:
  ```typescript
  else if (action.type === 'talk_with_user') {
      const isSystemError = action.content?.startsWith('[SYSTEM ERROR]');
      const isSynthetic = (action as any).isSynthetic === true;
      
      if (isSubagent) {
          if (isSystemError) {
              resultMsg = action.content || '';
              nextPrompt = resultMsg;
              continue; // Tenta se recuperar
          } else {
              // Subagentes não podem usar talk_with_user nem responder em formato inválido.
              // Aborta com FAILED de forma imediata.
              const summary = `Subagent returned invalid response format or tried to talk with user. Content: ${action.content}`;
              subagentManager.updateSubagentSummary(options.taskId!, summary);
              if (process.env.SHARK_PARENT_ID) {
                  subagentManager.sendMessage(
                      process.env.SHARK_PARENT_ID,
                      `[Subagent Notification] Subagent ${process.env.SHARK_SUBAGENT_ROLE || 'Subagent'} (${options.taskId}) failed. Reason: Returned raw text or unsupported action instead of valid JSON.`
                  );
              }
              keepGoing = false;
              break;
          }
      }
      // ... comportamento normal do coordenador ...
  }
  ```

- [ ] **Step 3: Ajustar prompts de autopercepção e schema de `complete_task`**
  - Em `src/core/api/prompts.ts`, alterar o schema `SUBAGENT_RESPONSE_JSON_SCHEMA` para colocar `summary` tanto dentro de `action` como na raiz, ou ajustar o código de leitura em `developer-agent.ts` (linha 891) para ler de ambos:
    ```typescript
    const taskSummary = action.summary || (parsedObj as any).summary || 'Task completed successfully.';
    ```
  - Em `src/core/api/prompts.ts`, no `SUBAGENT_SYSTEM_PROMPT`, esclarecer as regras de histórico e no `UNIFIED_SYSTEM_PROMPT` estruturar a injeção em XML.

- [ ] **Step 4: Atualizar testes quebrados em `developer-agent.test.ts`**
  Ajustar o teste `should send notification to parent on talk_with_user when running as subagent` para esperar falha imediata em vez de sucesso (sucesso é o comportamento antigo defeituoso). Adicionar novos testes para as condições de fallback sintético.

- [ ] **Step 5: Rodar suite inteira de testes e verificar aprovação**
  Executar: `npm run test`
  Resultado esperado: Todos os testes PASS.

- [ ] **Step 6: Commit**
  ```bash
  git add src/core/agents/developer-agent.ts src/core/api/prompts.ts src/core/agents/agent-response-parser.ts src/core/agents/developer-agent.test.ts
  git commit -m "fix: enforce strict fallback failure on subagent invalid formats and clean prompts"
  ```
