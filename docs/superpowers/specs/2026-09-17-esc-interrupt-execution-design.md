# Spec: Interrupção de Execução com Esc no Shark Dev

**Data:** 2026-09-17  
**Status:** Aprovado  
**Escopo:** `shark dev` (Interactive Developer Agent)

---

## 1. Visão Geral

Ao utilizar o `shark dev` interativamente, o agente pode seguir um caminho indesejado (loop de leituras redundantes, geração inadequada de código ou comando demorado). Atualmente, a única forma de interromper a execução é enviando `SIGINT` via `Ctrl+C`, o que encerra completamente o processo Node.js. Para retomar o trabalho, o usuário é obrigado a reabrir o terminal, rodar `shark dev` novamente e digitar `/chat` para restaurar a conversa.

Esta especificação introduz um mecanismo de interrupção instantânea através da tecla `Esc`. Ao pressionar `Esc` durante a execução (geração de resposta pelo LLM, execução de ferramentas ou espera de subagentes), a ação em andamento é abortada imediatamente, limpando processos filhos e retornando diretamente ao prompt interativo (`Your answer:`), preservando todo o histórico e a sessão ativa.

---

## 2. Requisitos e Comportamentos

### 2.1 Tecla de Interrupção
- **Tecla:** `Esc` (código ASCII 27 / `\u001b`).
- **Escopo de Ativação:** Ativo exclusivamente enquanto o agente estiver em segundo plano executando (streaming do LLM, executando tools ou aguardando notificações).
- **Inatividade nos Prompts:** Quando a CLI exibe um prompt interativo do usuário (`@clack/prompts`, `waitForInputOrNotification`), a captura isolada do `Esc` fica inativa para não interferir na navegação ou edição de texto do usuário.
- **Diferenciação ANSI:** O listener valida se o byte recebido é `Esc` isolado (`buf.length === 1 && buf[0] === 27`), ignorando sequências de escape multicaracter como as setas do teclado (`\u001b[A`, etc.).

### 2.2 Limpeza e Cancelamento Imediato
Ao detectar a tecla `Esc`:
1. **AbortSignal:** Um `AbortController` ativo emite sinal de cancelamento.
2. **Stream LLM:** A requisição HTTP ativa para o provedor (`streamChat`) é abortada via sinal do `fetch`.
3. **Processos Filhos (`run_command`):** Se houver um comando de terminal em execução, o processo (`child_process`) recebe encerramento imediato (`kill`).
4. **Subagentes Ativos:** Quaisquer subagentes filhos em execução no momento são finalizados via `subagentManager.killSubagent()`.
5. **Spinner e Feedback Visual:** O spinner do TUI é interrompido com mensagem de aviso clara:
   ```text
   🛑 Execução interrompida pelo usuário.
   Interrupção solicitada via Esc. Retornando ao chat interativo...
   ```

### 2.3 Preservação do Histórico e Contexto
1. A sessão ativa e a variável `activeConversationId` são 100% preservadas.
2. É inserida uma mensagem no histórico (`HistoryManager`):
   ```json
   {
     "role": "user",
     "content": "[Execução interrompida pelo usuário via Esc. A ação anterior foi cancelada antes de sua conclusão.]"
   }
   ```
3. O loop principal não finaliza; em vez disso, transiciona imediatamente para o prompt de entrada do usuário (`waitForInputOrNotification`), permitindo enviar nova instrução corretiva sem reiniciar o CLI.

### 2.4 Compatibilidade com `Ctrl+C`
- Pressionar `Ctrl+C` (`\u0003`) continua com seu comportamento padrão de saída rápida do sistema (`process.exit(130)`), garantindo que o usuário ainda tenha saída emergencial sempre disponível.

---

## 3. Arquitetura Técnica

### 3.1 Módulo `InterruptManager` (`src/core/terminal/interrupt-manager.ts`)
Responsável por gerenciar o ciclo de vida do listener de interrupção no terminal:
- `start(onInterrupt: () => void): AbortSignal`:
  - Se `process.stdin.isTTY`, coloca o `stdin` em modo raw (`setRawMode(true)`) e anexa listener para eventos de tecla.
  - Retorna o `AbortSignal` associado ao `AbortController`.
- `stop()`:
  - Remove o listener e restaura o terminal para `setRawMode(false)`.
- `isInterrupted(): boolean`:
  - Indica se o ciclo atual foi abortado.

### 3.2 Integração no Loop de `developer-agent.ts`
- No início de cada iteração de execução no loop `while (keepGoing)`:
  - `const interruptManager = new InterruptManager();`
  - `const signal = interruptManager.start(() => { /* rotina de cancelamento */ });`
- Passa o `signal` para `provider.streamChat` e ferramentas que suportam cancelamento.
- No bloco `finally` ou ao pausar para entrada do usuário:
  - `interruptManager.stop();`
- No tratamento de erro:
  - Se `error.name === 'AbortError'` ou `interruptManager.isInterrupted()`:
    - Exibe aviso visual no TUI.
    - Salva notificação no histórico da conversa ativa.
    - Chama `waitForInputOrNotification` para receber a nova instrução do usuário.

---

## 4. Testes e Validação

1. **Testes Unitários de `InterruptManager` (`interrupt-manager.test.ts`):**
   - Emissão de `Esc` isolado dispara callback de interrupção e aborta o sinal.
   - Emissão de sequências ANSI (ex.: setas `\u001b[A`) não dispara interrupção.
   - Chamadas em ambiente não-TTY não causam exceção (no-op seguro).
   - Múltiplos toques de `Esc` executam com idempotência/debounce.
2. **Testes de Integração em `developer-agent.test.ts`:**
   - Simulação de interrupção com `AbortSignal` durante iteração do agente.
   - Verificação de que o histórico da conversa permanece com a conversa ativa e registra o aviso de interrupção.
   - Verificação de que a sessão não é encerrada e aguarda nova entrada.
3. **Validação Manual:**
   - Execução de `shark dev` no terminal real (PowerShell / Windows Terminal).
   - Início de uma tarefa longa ou leitura e pressão da tecla `Esc`.
   - Constatação de retorno imediato ao prompt sem perda de histórico.
