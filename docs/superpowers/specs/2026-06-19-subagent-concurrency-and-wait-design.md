# Especificação de Design: Concorrência e Ação Wait de Subagentes no Shark AI

- **Data**: 2026-06-19
- **Status**: Revisado e Aprovado pelo Usuário
- **Autor**: Antigravity AI

---

## 1. Contexto e Motivação

Durante a orquestração de subagentes no **Shark AI**, identificamos um problema clássico de loops ociosos (busy-wait) e concorrência:
1. O agente principal (parent) inicia um subprocesso filho (subagente) em segundo plano.
2. Como a execução é não-bloqueante, o orquestrador imediatamente chama a LLM para o próximo turno.
3. Sem novas informações e sem uma ação de "espera", o modelo se confunde e tende a invocar novamente o mesmo subagente redundantemente.
4. Notificações de falha ou sucesso de subagentes anteriores que terminaram atrasadas acabam entrando na fila (`MessageQueue`) e confundindo o agente em turnos subsequentes (mensagens fantasmas).

Este documento especifica a introdução da ação `wait`, injeção dinâmica de status no prompt, leitura de logs de console em tempo real e encerramento limpo com status `cancelled` para resolver esses problemas.

---

## 2. Escopo da Solução

Implementar quatro melhorias coordenadas:
1. **Ação `wait`**: Um comando explícito e parametrizado que permite ao agente dormir voluntariamente (com tempo máximo) até receber atualizações.
2. **Painel Dinâmico de Subagentes**: Injeção do estado atual dos subagentes no prompt de entrada a cada rodada.
3. **Ação `read_logs`**: Permitir que o agente pai leia logs de console em tempo real de um subagente ativo para verificar progresso.
4. **Encerramento Limpo (`kill` e status `cancelled`)**: Tratamento de encerramento via `SIGTERM` que diferencia erros (`failed`) de abortos deliberados do pai (`cancelled`).

---

## 3. Arquitetura Detalhada e Alterações

### 3.1. Alterações no Prompt e Schema (`src/core/api/prompts.ts`)

#### Adição da Ação no Enum do Schema
No `AGENT_RESPONSE_JSON_SCHEMA`, o campo `action.properties.type.enum` receberá o valor `"wait"`.
Também será adicionado o campo opcional `duration_seconds` nas propriedades da ação:

```json
"duration_seconds": {
  "type": ["integer", "null"],
  "description": "Tempo máximo em segundos para aguardar atualizações."
}
```

No `UNIFIED_SYSTEM_PROMPT`, a ação `"wait"` e a propriedade `"duration_seconds"` serão documentadas na assinatura da saída do JSON e nas diretrizes de concorrência.

#### Ação de Leitura de Logs no `manage_subagents`
A ação `manage_subagents` será estendida para suportar a ação `"read_logs"`.

---

### 3.2. Controle de Loop e Espera (`src/core/agents/developer-agent.ts`)

#### Injeção do Painel de Subagentes
Antes de enviar o prompt à LLM, o loop principal irá consultar `subagentManager.getActiveSubagents()` e formatar um bloco de markdown detalhando os subagentes `RUNNING`, `COMPLETED`, `FAILED` e `cancelled` associados ao `taskId` atual (ou parent).

#### Lógica do Manipulador da Ação `wait`
```typescript
else if (action.type === 'wait') {
    const duration = action.duration_seconds ? action.duration_seconds * 1000 : undefined;
    log.info(`⏳ Waiting for subagent updates or user response... (Timeout: ${action.duration_seconds || 'infinite'}s)`);
    
    // waitForInputOrNotification deve ser modificado para aceitar um timeout opcional
    const nextMsg = await waitForInputOrNotification(messageQueue, 'Your answer:', subagentPrefix, duration);
    
    if (nextMsg.type === 'timeout') {
        resultMsg = `[System]: Wait timeout of ${action.duration_seconds}s expired. No new subagent events received.`;
    } else if (nextMsg.type === 'user') {
        resultMsg = `User Reply: ${nextMsg.content}`;
    } else {
        resultMsg = nextMsg.content;
    }
}
```

#### Tratamento de Encerramento (Limpeza de Órfãos)
Adicionar no bloco `finally` da função `interactiveDeveloperAgent` ou em ganchos globais de saída do processo (`process.on('SIGINT')`, etc.) a interrupção limpa de todos os subagentes ativos do escopo atual para evitar vazamento de memória.

---

### 3.3. Gerenciamento de Subprocessos (`src/core/workflow/subagent-manager.ts`)

#### Adição do Status `cancelled`
Alterar a interface de estados dos subagentes para aceitar o status `'cancelled'`:
```typescript
status: 'running' | 'completed' | 'failed' | 'cancelled';
```

#### Implementação da Ação `kill` e `read_logs`
*   **Ação `kill`**: Envia `SIGTERM` ao subprocesso. Se finalizado por este caminho, atualiza o status para `cancelled`. Adiciona a mensagem `"Terminated by parent agent"` na caixa postal e acorda a fila.
*   **Ação `read_logs`**: Abre e lê o arquivo de histórico de log associado `_sharkrc/history/subagent-subagent-<id>-console.log` e retorna as últimas `N` linhas ao agente pai.

---

## 4. Plano de Testes e Validação

1.  **Validação de Schema**: Verificar se o JSON retornado com `action: { type: "wait" }` é aceito e passa pelo parser de comandos sem erros.
2.  **Verificação de Espera Interrompível**:
    *   Iniciar um subagente e executar a ação `wait` por 60 segundos.
    *   Concluir o subagente após 5 segundos.
    *   Garantir que o agente pai acorda imediatamente aos 5 segundos e não aguarda o tempo todo.
3.  **Verificação de Logs**: Garantir que o agente pai pode consultar as linhas de console ativas do subagente.
4.  **Teste de Limpeza de Processos**: Abortar o processo principal com `Ctrl+C` e rodar `ps aux` para confirmar que nenhum processo `node` filho ficou executando em segundo plano.
