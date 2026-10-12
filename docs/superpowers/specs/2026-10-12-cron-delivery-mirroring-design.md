# Design Técnico: Espelhamento de Notificações de Cronjob (Delivery Mirroring) e Reativação de Contexto

**Data**: 2026-10-12  
**Status**: Aprovado  
**Escopo**: Shark AI Core (`src/core/cron`, `src/core/workflow`, `src/core/engine`, `src/core/api`)  

---

## 1. Contexto e Problema

No Shark AI, quando uma tarefa agendada ou cronjob executa e entrega uma notificação externa para o usuário (via WhatsApp, Telegram ou CLI), o agente até então não persistia essa entrega no histórico da sessão de diálogo. 

Isso causava o problema de **"amnésia de notificação"**: quando o usuário recebia o lembrete ou relatório no aplicativo e respondia (ex.: *"Legal, qual é o primeiro passo?"*), a LLM recebia apenas a resposta do usuário sem saber o que havia sido entregue anteriormente, quebrando a continuidade da conversa.

Inspirado na arquitetura do **Hermes Agent**, este design estabelece o mecanismo de **Delivery Mirroring** com as seguintes garantias:
1. **Papel `role: 'user'` com Prefixo Estruturado**: Notificações automáticas são registradas como mensagens de usuário marcadas (`[Cron delivery: <nome>]`), funcionando como eventos ambientais.
2. **Fusão em Memória de Papéis Consecutivos (*Consecutive-User Merge*)**: Antes de enviar o payload à API de LLM, o backend sanitiza mensagens consecutivas de `user` fundindo-as com quebra de linha dupla, respeitando rigorosamente a alternância de turnos exigida pelos provedores (Anthropic, Gemini, OpenAI).
3. **Fonte Única de Verdade no SQLite (`state.db`)**: Persistência transacional com indexação FTS5 para `session_search` e sincronização direta com o `HistoryManager`.

---

## 2. Arquitetura e Componentes

```
 ┌────────────────────────────────────────────────────────┐
 │           CronScheduler / CronExecutor                 │
 │      (Executa o job e produz a saída final)            │
 └──────────────────────────┬─────────────────────────────┘
                            │
                            ▼
 ┌────────────────────────────────────────────────────────┐
 │            AgentEngine.deliverCronResult()             │
 │   1. Envia via adapter (WhatsAppAdapter / CliAdapter)  │
 │   2. Confirma entrega bem-sucedida (deliverySuccess)   │
 └──────────────────────────┬─────────────────────────────┘
                            │
                            ▼
 ┌────────────────────────────────────────────────────────┐
 │             CronDeliveryMirror.mirrorToSession()       │
 │   - Avalia elegibilidade ([SILENT], local, broadcast)  │
 │   - Formata: [Cron delivery: <Nome>]\n<Conteúdo>       │
 └─────────────┬───────────────────────────┬──────────────┘
               │                           │
               ▼                           ▼
 ┌───────────────────────────┐ ┌───────────────────────────┐
 │       StateDB (SQLite)    │ │      HistoryManager       │
 │  INSERT INTO messages ... │ │  appendMessage(..., user) │
 │  (Indexação FTS5 WAL)     │ │  (Prompt da Sessão Ativa) │
 └───────────────────────────┘ └─────────────┬─────────────┘
                                             │
                                             ▼
                               ┌───────────────────────────┐
                               │    mergeConsecutiveRoles  │
                               │  (Sanitização em memória  │
                               │   no Provider HTTP)       │
                               └───────────────────────────┘
```

---

## 3. Especificação Detalhada

### 3.1 Modelagem de Dados (`cron-types.ts` & `cron-tool-handler.ts`)
- O modelo `CronJob` e a interface `CronToolArgs` ganham o campo:
  ```typescript
  attach_to_session?: boolean;
  ```
- **Regras de Negócio na Tool `cronjob`**:
  - `deliver: "origin"` ou omitido: `attach_to_session` assume `true` por padrão.
  - `deliver: "local"` ou `deliver: "all"`: nunca espelha (`false`).
  - Destinos específicos/terceiros (ex: `deliver: "whatsapp:123456"`): espelha apenas se `attach_to_session === true`.

### 3.2 Componente `CronDeliveryMirror` (`src/core/cron/cron-delivery-mirror.ts`)
Responsável pela regra de espelhamento com os seguintes guardas:
1. **Guarda de Entrega**: `if (!deliverySuccess) return false;`
2. **Guarda de Silêncio**: `if (text.includes('[SILENT]') || text.includes('NO_REPLY')) return false;`
3. **Guarda de Escopo Local/Broadcast**: `if (job.deliver === 'local' || job.deliver === 'all') return false;`
4. **Guarda de Elegibilidade**: `if (job.deliver !== 'origin' && !job.attach_to_session) return false;`
5. **Gravação**:
   - `StateDB.recordMessage(sessionId, 'user', formattedContent)`
   - `HistoryManager.appendMessage(conversationId, { role: 'user', content: formattedContent })`
   - Atualiza `rawHistory` no `HistoryManager` para persistência consistente.

### 3.3 Normalização de Mensagens (`mergeConsecutiveRoles`)
Adicionada em `src/core/workflow/history-manager.ts`:
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
Aplicada nos métodos `streamChat` de:
- `OpenAICompatibleProvider` (`src/core/api/openai-compatible-provider.ts`)
- `StackspotProvider` (`src/core/api/stackspot-provider.ts`)

---

## 4. Testes e Validação

1. **`cron-delivery-mirror.test.ts`**:
   - Valida espelhamento com `deliver: 'origin'` e `attach_to_session: true`.
   - Valida bloqueio em caso de falha de entrega, `[SILENT]`, `deliver: 'local'`, `deliver: 'all'` ou terceiros sem flag.
   - Valida persistência atômica no SQLite e no `HistoryManager`.
2. **`history-manager.test.ts`**:
   - Valida `mergeConsecutiveRoles` fundindo `user` + `user` em bloco único.
   - Valida preservação de sequências alternadas normais e mensagens de sistema.
3. **`cron-tool-handler.test.ts`**:
   - Valida criação e edição de cronjobs com `attach_to_session`.
