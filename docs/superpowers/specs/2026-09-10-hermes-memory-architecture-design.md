# Especificação de Design: Arquitetura de Memória Determinística (Padrão Hermes) para Shark AI

- **Data**: 2026-09-10
- **Status**: Aprovado no Brainstorming
- **Autor**: Miguel Arcangelo & Antigravity
- **Alvo**: Shark AI (`bmadspot`)

---

## 1. Visão Geral e Contexto

O subsistema de memória do Shark AI atualmente conta com módulos de alta complexidade em tempo de execução:
- **Membox**: Compactação assíncrona com embeddings locais ONNX (`all-MiniLM-L6-v2`) via `@xenova/transformers`.
- **ACE**: Orquestrador de contexto elástico com pontuação semântica BM25 e análise sintática via AST.

Esses módulos estocásticos introduzem latência de inicialização, alto consumo de memória, quebra contínua do **Prompt Caching** e instabilidade na preservação de contexto do agente.

Inspirado na arquitetura do **Hermes Agent**, este design substitui o Membox e o ACE por uma arquitetura em 3 camadas puramente determinística:
1. **MemoryStore**: Arquivos planos estáticos (`MEMORY.md`, `USER.md`, `SOUL.md`) com limites rígidos de caracteres e injeção em padrão *Frozen Snapshot* (preservando o prompt caching).
2. **StateDB**: Banco SQLite local (`state.db`) com tabela virtual FTS5 para busca textual ultra-rápida de sessões anteriores (`session_search` <10ms).
3. **ContextCompressor**: Gerenciador de janela de contexto baseado em *Tail Protection* (preservando turnos 0/1 e as últimas 15 mensagens), compactando o miolo intermediário em um resumo executivo padronizado via modelo padrão com fallback determinístico.

---

## 2. Decisões Arquiteturais e Governança

### 2.1 Divisão de Escopo Híbrida (Global vs. Local)

Para suportar projetos simples, monorepos e arquiteturas multirrepo / microfrontends sem contaminação de contexto:

| Escopo | Arquivo | Finalidade | Permissão do Agente | Limite Rígido |
| :--- | :--- | :--- | :--- | :--- |
| **Global (`~/.shark/`)** | `USER.md` | Perfil do desenvolvedor, estilo de comunicação e preferências globais. | Leitura e Escrita | 1.375 chars (~500 tokens) |
| **Global (`~/.shark/`)** | `SOUL.md` | Identidade, tom de voz, regras de segurança e postura do Shark AI. | **Somente Leitura** | 1.000 chars (~350 tokens) |
| **Local (`<workspace>/.shark/`)** | `MEMORY.md` | Fatos perenes, portas de serviços, comandos de build e atalhos daquele repositório específico. | Leitura e Escrita | 2.200 chars (~800 tokens) |
| **Local (`<workspace>/.shark/`)** | `state.db` | Banco SQLite contendo o histórico de turnos e mensagens do projeto. | Gerenciado pelo Runtime / Tool | N/A (SQLite em disco) |

### 2.2 Preservação do Prompt Caching (*Frozen Snapshot*)
- No início da sessão CLI (`shark`), o `MemoryStore` carrega os arquivos `USER.md`, `SOUL.md` e `MEMORY.md` e compõe o bloco de contexto inicial no System Prompt.
- Durante a sessão, o System Prompt **permanece 100% estático**.
- Se o agente invocar a ferramenta `memory` para adicionar ou alterar anotações, a persistência no disco é imediata, mas o System Prompt da sessão em execução não é modificado. O novo snapshot só entrará no System Prompt na sessão seguinte.

### 2.3 Resumo do Miolo com Estratégia Híbrida e Fallback
Quando o total de tokens do histórico acumulado ultrapassa **80% do limite da janela de contexto**, o `ContextCompressor` divide a conversa em três segmentos:
1. **Pinned**: Turnos 0 e 1 (System Prompt + Objetivo inicial do usuário).
2. **Tail**: Os últimos 15 turnos mantidos 100% intactos com todas as chamadas de ferramentas e saídas completas.
3. **Middle**: As mensagens intermediárias são condensadas em um único turno no seguinte formato estruturado:

```markdown
[Summary of earlier turns]
- Objetivo Principal: <intenção consolidada da tarefa>
- Decisões Técnicas: <decisões de arquitetura, libs e convenções>
- Arquivos Modificados: <caminhos de arquivos criados/editados>
- Próximo Passo: <direcionamento atual imediato>
```

- **Mecanismo de Geração**:
  - **Primário**: Chamada pontual à LLM padrão configurada com prompt estruturado de sumarização.
  - **Fallback Determinístico**: Em caso de timeout (>5s), status 429 ou erro de conexão, aciona um extrator algorítmico local que sintetiza as ações de ferramentas e arquivos tocados sem depender de rede.

---

## 3. Especificação dos Componentes

### 3.1 `MemoryStore` (`src/core/memory/memory-store.ts`)
- Carrega e formata snapshots de memória.
- Cria arquivos padrão com templates limpos em caso de cold start.
- Valida limites de caracteres e bloqueia escrita em `SOUL.md`.

```typescript
export interface MemorySnapshot {
  memory: string;
  user: string;
  soul: string;
  composedPromptBlock: string;
}

export class MemoryStore {
  private globalDir: string;
  private localDir: string;

  constructor(customPaths?: { globalDir?: string; localDir?: string });
  async loadSnapshot(): Promise<MemorySnapshot>;
  async updateFile(filename: 'MEMORY.md' | 'USER.md', content: string): Promise<void>;
  async readFile(filename: 'MEMORY.md' | 'USER.md' | 'SOUL.md'): Promise<string>;
}
```

### 3.2 `StateDB` (`src/core/memory/state-db.ts`)
- Implementado sobre `better-sqlite3`.
- Salva todas as mensagens da sessão de forma síncrona/segura.
- Utiliza modo WAL (`PRAGMA journal_mode = WAL;`) e tabela virtual FTS5 com disparos automáticos via triggers.

```sql
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  content,
  content='messages',
  content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
END;

CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.id, old.content);
END;

CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.id, old.content);
  INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
END;
```

```typescript
export interface SearchResult {
  sessionId: string;
  role: string;
  content: string;
  timestamp: string;
  rank: number;
}

export class StateDB {
  constructor(dbPath?: string);
  recordMessage(sessionId: string, role: string, content: string): void;
  search(query: string, options?: { limit?: number; sessionId?: string }): SearchResult[];
  close(): void;
}
```

### 3.3 `ContextCompressor` (`src/core/workflow/context-compressor.ts`)
- Substitui o `ace-context-orchestrator.ts`.
- Utiliza `gpt-tokenizer` para medição rápida e determinística do consumo de tokens.
- Implementa particionamento: Pinned (0, 1), Tail (últimos 15) e Middle (resumido).

```typescript
export interface CompressOptions {
  tokenLimit: number;
  thresholdRatio?: number; // default: 0.8
  tailSize?: number; // default: 15
  summarizer?: (messages: ChatMessage[]) => Promise<string>;
}

export class ContextCompressor {
  static async compress(
    history: ChatMessage[],
    options: CompressOptions
  ): Promise<{ history: ChatMessage[]; wasCompressed: boolean }>;
}
```

---

## 4. Estrutura e Composição do System Prompt

O System Prompt (`UNIFIED_SYSTEM_PROMPT`) é montado no boot da sessão como um **Frozen Snapshot** imutável.

### 4.1 Composição Modular

```
┌────────────────────────────────────────────────────────────────────────┐
│                        COMPOSIÇÃO DO PROMPT                            │
├────────────────────────────────────────────────────────────────────────┤
│ 1. Core Runtime & Instruções Base                                      │
│    • Identidade: Shark Dev                                             │
│    • Formato de Resposta: JSON estrito ({thought, action, summary})    │
│    • Sistema de Âncoras: Formato palavra_âncora§conteúdo da linha      │
│    • Orquestração de Subagentes: invoke_subagent, mailbox, wait        │
│                                                                        │
│ 2. Novas Ações de Memória & Busca no JSON Action                       │
│    • "memory": {"action": "read"|"write"|"replace"|"remove",           │
│                 "filename": "MEMORY.md"|"USER.md", ...}                │
│    • "session_search": {"query": "termo", "limit": 5}                  │
│    (Remoção total de "⚡ SISTEMA DE CONTEXTO ELÁSTICO (ACE)")          │
│                                                                        │
│ 3. Bloco de Identidade & Persona (<soul>)                              │
│    • Carregado de ~/.shark/SOUL.md                                     │
│                                                                        │
│ 4. Bloco de Preferências do Usuário (<user_profile>)                   │
│    • Carregado de ~/.shark/USER.md                                     │
│                                                                        │
│ 5. Bloco de Memória do Repositório (<project_memory>)                  │
│    • Carregado de <workspace>/.shark/MEMORY.md                         │
│                                                                        │
│ 6. Bloco de Contexto do Projeto (<project_context>)                   │
│    • Carregado do AGENTS.md da raiz do workspace, se existir           │
└────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Template do Bloco de Memória Injetado no Prompt

```markdown
ℹ️ SISTEMA DE MEMÓRIA E HISTÓRICO DETERMINÍSTICO:
- Você possui memória persistente em arquivos planos e histórico indexado via SQLite FTS5.
- Ação 'memory': Use para registrar fatos persistentes do projeto em 'MEMORY.md' ou preferências do desenvolvedor em 'USER.md'. Suas alterações são salvas em disco imediatamente.
- Ação 'session_search': Use para pesquisar discussões, decisões ou trechos de código em sessões anteriores do projeto no banco de dados local.
- As anotações abaixo foram carregadas no início desta sessão (Frozen Snapshot) e permanecem como referência estática.

<soul>
{{SOUL_CONTENT}}
</soul>

<user_profile>
{{USER_CONTENT}}
</user_profile>

<project_memory>
{{MEMORY_CONTENT}}
</project_memory>

<project_context>
{{AGENTS_MD_CONTENT}}
</project_context>
```

---

## 5. Ferramentas do Agente

### 5.1 `memory` (`src/core/tools/memory-tool.ts`)
- **Ações**: `read`, `write`, `replace`, `remove`.
- **Validação**: Rejeita modificações em `SOUL.md` com erro de autorização (`Permission denied. SOUL.md is read-only`). Rejeita conteúdos maiores que os limites com mensagem de capacidade excedida.

### 5.2 `session_search` (`src/core/tools/session-search-tool.ts`)
- **Ações**: Consulta `messages_fts` com query MATCH. Retorna resultados formatados com metadados em latência sub-10ms.

---

## 6. Plano de Descomissionamento e Limpeza

1. **Remoção de Arquivos Legados**:
   - `src/core/workflow/membox-manager.ts` e seus testes.
   - `src/core/workflow/embedding-service.ts` e seus testes.
   - `src/core/api/ace-context-orchestrator.ts` e seus testes.
   - Caches em disco (`.vitest_cache_membox`, `.vitest_membox_storage`, modelos ONNX).
2. **Atualização de Provedores e Prompts**:
   - Atualização de `src/core/api/prompts.ts` para o novo layout com `memory`, `session_search` e tags XML.
   - Substituição de chamadas de compactação no `StackSpotProvider` e `OpenAICompatibleProvider` para o `ContextCompressor`.
3. **Dependências**:
   - Adicionar `better-sqlite3` e `@types/better-sqlite3`.
   - Limpar referências a módulos de embeddings em `package.json`.

---

## 7. Estratégia de Testes

- **Testes Unitários**:
  - `memory-store.test.ts`: Validação de limites rígidos, isolamento de paths, e proteção de leitura de `SOUL.md`.
  - `state-db.test.ts`: Gravação de mensagens, validação de busca FTS5 e teste de estresse de performance (<10ms).
  - `context-compressor.test.ts`: Proteção estrita do Turno 0/1 e cauda de 15 turnos, acionamento aos 80% do budget e fallback determinístico em caso de falha da LLM.
- **Testes de Integração**:
  - Verificação do ciclo de vida completo da sessão com Frozen Snapshot persistindo entre execuções e prompt de sistema estável.
