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
1. **MemoryStore**: Arquivos planos estáticos (`MEMORY.md`, `USER.md`, `SOUL.md`) com limites rígidos de caracteres, autopercepção de capacidade no cabeçalho e injeção em padrão *Frozen Snapshot* (preservando o prompt caching).
2. **StateDB**: Banco SQLite local (`state.db`) com tabela virtual FTS5 para busca textual ultra-rápida de sessões anteriores (`session_search` <10ms).
3. **ContextCompressor**: Gerenciador de janela de contexto baseado em *Tail Protection* (preservando turnos 0/1 e as últimas 15 mensagens), compactando o miolo intermediário em um resumo executivo padronizado via modelo padrão com fallback determinístico.

---

## 2. Decisões Arquiteturais e Governança

### 2.1 Divisão de Escopo Híbrida (Global vs. Local)

Para suportar projetos simples, monorepos e arquiteturas multirrepo / microfrontends sem contaminação de contexto:

| Escopo | Arquivo | Finalidade | Permissão do Agente | Limite Rígido |
| :--- | :--- | :--- | :--- | :--- |
| **Global (`~/.shark/`)** | `USER.md` | Perfil do desenvolvedor, estilo de comunicação e preferências globais. | Leitura e Escrita (`user`) | 1.375 chars (~500 tokens) |
| **Global (`~/.shark/`)** | `SOUL.md` | Identidade, tom de voz, regras de segurança e postura do Shark AI. | **Estritamente Somente Leitura** | 1.000 chars (~350 tokens) |
| **Local (`<workspace>/.shark/`)** | `MEMORY.md` | Fatos perenes, portas de serviços, comandos de build e atalhos daquele repositório específico. | Leitura e Escrita (`memory`) | 2.200 chars (~800 tokens) |
| **Local (`<workspace>/.shark/`)** | `state.db` | Banco SQLite contendo o histórico de turnos e mensagens do projeto. | Gerenciado pelo Runtime / Tool | N/A (SQLite em disco) |

### 2.2 Governança Estrita na Ferramenta de Memória
A ferramenta `memory_tool` valida rigorosamente o alvo de escrita:
```typescript
const ALLOWED_TARGETS = ['memory', 'user'] as const;

if (!ALLOWED_TARGETS.includes(target)) {
  throw new Error(
    `Alvo inválido: '${target}'. O agente só possui permissão de escrita em 'MEMORY.md' e 'USER.md'. O arquivo 'SOUL.md' é estritamente somente-leitura.`
  );
}
```
* **Proteção contra Prompt Injection e Drift**: Manter `SOUL.md` somente-leitura impede que instruções maliciosas injetadas em arquivos lidos pelo agente sobrescrevam a identidade ou burlem as diretrizes de segurança de forma permanente.

### 2.3 A Regra do *Frozen Snapshot* (Preservação do Prompt Caching)
- O System Prompt é montado **uma única vez no boot** da CLI (`shark`).
- Quando o agente executa a ferramenta `memory` (ações `add`, `replace`, `remove`), o arquivo no disco é gravado imediatamente.
- O System Prompt da sessão em andamento **não é reconstruído**. O fato permanece fresco na memória imediata da conversa atual e passará a integrar o System Prompt a partir da sessão seguinte ou após uma compactação de janela.
- **Benefício de Custo e Latência**: Manter o prefixo do System Prompt 100% estático reduz os custos de entrada da LLM em até 75%-90% via Prompt Caching da API.

---

## 3. Estrutura Modular do System Prompt (Padrão 3 Camadas)

Para maximizar a estabilidade do prefixo e garantir que a LLM saiba exatamente como agir, o System Prompt é organizado em três camadas ordenadas por taxa de variação:

```
┌────────────────────────────────────────────────────────────────────────┐
│ 1. CAMADA ESTÁVEL (Prefix Cache — Quase nunca muda)                   │
│    ├── Identidade Base & Persona (SOUL.md lido de ~/.shark/SOUL.md)    │
│    ├── Diretrizes Gerais de Uso de Ferramentas & Sistema de Âncoras    │
│    ├── Contrato do Formato de Saída (JSON estrito)                     │
│    ├── Protocolo de Auto-gerenciamento de Memória & FTS5               │
│    └── Índice Leve de Skills (Progressive Disclosure)                  │
├────────────────────────────────────────────────────────────────────────┤
│ 2. CAMADA DE CONTEXTO DO REPOSITÓRIO (Estável por Projeto)             │
│    └── Regras da Base de Código (AGENTS.md lido da raiz do workspace)  │
├────────────────────────────────────────────────────────────────────────┤
│ 3. CAMADA VOLÁTIL DE MEMÓRIA (Snapshots Congelados da Sessão)          │
│    ├── Snapshot de MEMORY.md com Indicador [XX% — Y/2.200 chars]       │
│    ├── Snapshot de USER.md com Indicador [XX% — Y/1.375 chars]         │
│    └── Metadados da Sessão (Timestamp / Session ID)                    │
└────────────────────────────────────────────────────────────────────────┘
```

### 3.1 Revelação Progressiva de Habilidades (Progressive Disclosure)
- O System Prompt **não carrega** o conteúdo integral de arquivos `SKILL.md`.
- Ele injeta apenas um índice leve com o nome e resumo curto (até 60 chars) de cada skill disponível.
- Quando o agente precisa de uma habilidade procedural extensa, invoca `activate_skill(skill_name="...")`. O conteúdo do `SKILL.md` é lido do disco e inserido no histórico da conversa como um turno regular, mantendo o prefixo do System Prompt intocado.

### 3.2 Autopercepção de Capacidade nos Cabeçalhos
Para que o agente saiba exatamente quanto espaço ainda tem antes de salvar novos fatos, os blocos de memória são injetados com contadores explícitos:

```markdown
══════════════════════════════════════════════
MEMORY (notas do projeto) [67% — 1.474/2.200 chars]
══════════════════════════════════════════════
O projeto utiliza Node.js v20 com Vitest para testes unitários
§
O ambiente local roda Docker no Linux Ubuntu 24.04

══════════════════════════════════════════════
USER PROFILE [30% — 412/1.375 chars]
══════════════════════════════════════════════
O usuário utiliza Linux Ubuntu 24.04
§
Prefere respostas diretas e sem introduções

Timestamp: 2026-09-10T10:00:00-04:00
Session: shark-sess-8f92a1
```

---

## 4. Governança de Memória: Como, Quando e Quanto Atualizar

### 4.1 Diretrizes de Decisão (Gatilhos)

| Alvo | O Que Salvar | Quando Salvar | O Que Descartar (Filtro) |
| :--- | :--- | :--- | :--- |
| `memory` (`MEMORY.md`) | Fatos perenes sobre o repositório, portas de microsserviços, comandos de build/test, convenções e soluções de bugs recorrentes. | Proativamente, no momento em que descobre ou valida um fato relevante durante a execução. | Logs extensos de terminal, código temporário, caminhos efêmeros. |
| `user` (`USER.md`) | Preferências de comunicação ("seja conciso"), stack favorita, estilo de código declarado pelo desenvolvedor. | Quando o dev declara uma preferência ou corrige a postura/estilo de resposta do agente. | Conversas informais ou instruções pontuais da tarefa atual. |

### 4.2 Protocolo de Tratamento de Estouro (Auto-Recuperação no Mesmo Turno)
Quando uma tentativa de `add` ultrapassa o teto do arquivo, a `memory_tool` **não trunca silenciosamente**. Ela cancela a gravação e retorna uma mensagem estruturada com o estado atual:

```json
{
  "success": false,
  "error": "Memory at 2,100/2,200 chars. Adding this entry (250 chars) would exceed the limit. Consolidate now: use 'replace' to merge overlapping entries into shorter ones or 'remove' stale entries (see current_entries below), then retry this add — all in this turn.",
  "current_entries": [
    "O projeto utiliza Node.js v20 com Vitest para testes unitários",
    "Instalada biblioteca de validação Zod no backend"
  ],
  "usage": "2,100/2,200"
}
```

**Protocolo de Auto-Recuperação do Modelo**:
1. O agente recebe o erro estruturado contendo a lista `current_entries`.
2. Na mesma rodada lógica, o agente executa `replace` (para condensar duas entradas em uma frase concisa) ou `remove` (para apagar uma nota obsoleta).
3. Logo após liberar espaço, ele reexecuta o `add`.

---

## 5. Especificação dos Componentes

### 5.1 `MemoryStore` (`src/core/memory/memory-store.ts`)
- Carrega e formata snapshots de memória com cabeçalhos de capacidade.
- Cria templates padrões concisos no cold start.
- Valida limites estritos e restrição de somente-leitura no `SOUL.md`.

```typescript
export interface MemorySnapshot {
  memory: string;
  user: string;
  soul: string;
  memoryUsage: { current: number; max: number; percentage: number };
  userUsage: { current: number; max: number; percentage: number };
  composedPromptBlock: string;
}

export class MemoryStore {
  private globalDir: string;
  private localDir: string;

  constructor(customPaths?: { globalDir?: string; localDir?: string });
  async loadSnapshot(): Promise<MemorySnapshot>;
  async updateFile(target: 'memory' | 'user', action: 'add' | 'replace' | 'remove', content: string, oldStr?: string): Promise<{ success: boolean; usage: string; current_entries?: string[] }>;
  async readFile(target: 'memory' | 'user' | 'soul'): Promise<string>;
}
```

### 5.2 `StateDB` (`src/core/memory/state-db.ts`)
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

### 5.3 `ContextCompressor` (`src/core/workflow/context-compressor.ts`)
- Substitui o `ace-context-orchestrator.ts`.
- Utiliza `gpt-tokenizer` para medição rápida e determinística do consumo de tokens.
- Dispara quando o histórico acumulado ultrapassa **80% do limite da janela**.
- Implementa particionamento:
  1. **Pinned (Turnos 0 e 1)**: System Prompt congelado + primeiro comando do usuário.
  2. **Tail (Últimos 15 turnos)**: 100% intactos com chamadas de ferramentas recentes.
  3. **Middle**: Condensado no bloco estruturado `[Summary of earlier turns]`.
- **Estratégia Híbrida**: Chamada LLM primária com fallback determinístico estruturado em caso de timeout (>5s) ou falha de rede.

---

## 6. Ferramentas do Agente

### 6.1 `memory` (`src/core/tools/memory-tool.ts`)
- **Schema Zod**:
  ```typescript
  export const memoryToolSchema = z.object({
    action: z.enum(['add', 'replace', 'remove', 'read']),
    target: z.enum(['memory', 'user']).describe("Alvo da memória: 'memory' (MEMORY.md local) ou 'user' (USER.md global)"),
    content: z.string().optional().describe('Conteúdo a adicionar ou novo conteúdo em substituição'),
    old_str: z.string().optional().describe('Trecho exato a ser substituído ou removido')
  });
  ```
- **Retorno**: Sucesso com capacidade atualizada ou erro guiado para auto-recuperação.

### 6.2 `session_search` (`src/core/tools/session-search-tool.ts`)
- **Schema Zod**:
  ```typescript
  export const sessionSearchToolSchema = z.object({
    query: z.string().describe('Termos de busca textual para encontrar mensagens em sessões anteriores'),
    limit: z.number().int().min(1).max(20).default(5)
  });
  ```
- **Execução**: Consulta FTS5 MATCH no `state.db` local com ordenação BM25 nativa e latência < 10ms.

---

## 7. Plano de Descomissionamento e Limpeza

1. **Remoção de Arquivos Legados**:
   - `src/core/workflow/membox-manager.ts` e seus testes.
   - `src/core/workflow/embedding-service.ts` e seus testes.
   - `src/core/api/ace-context-orchestrator.ts` e seus testes.
   - Pastas de modelos locais (`src/resources/models/all-MiniLM-L6-v2/`).
   - Caches em disco (`.vitest_cache_membox`, `.vitest_membox_storage`).
2. **Atualização de Provedores e Prompts**:
   - Atualizar `src/core/api/prompts.ts` com o novo template de 3 camadas e remoção do ACE.
   - Integrar `ContextCompressor` no `StackSpotProvider` e `OpenAICompatibleProvider`.
3. **Dependências**:
   - Instalar `better-sqlite3` e `@types/better-sqlite3`.
   - Limpar eventuais dependências não utilizadas em `package.json`.

---

## 8. Estratégia de Testes

- **Testes Unitários**:
  - `memory-store.test.ts`: Testar limits rígidos, rejeição de escrita em `SOUL.md`, cálculo de capacidade percentual no cabeçalho e erro guiado de recuperação em caso de estouro.
  - `state-db.test.ts`: Gravação de mensagens, validação de triggers FTS5 e teste de performance de busca (<10ms).
  - `context-compressor.test.ts`: Proteção de Turnos 0/1 e dos últimos 15 turnos, acionamento aos 80% e fallback determinístico.
- **Testes de Integração**:
  - Validar imutabilidade do System Prompt durante toda a sessão, mesmo após chamadas de `memory`.
