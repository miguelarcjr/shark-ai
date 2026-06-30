# Especificação de Design: Integração do Membox no Shark Dev (Abordagem C - Compactação Asíncrona)

Esta especificação descreve a implementação do sistema de memória hierárquica **Membox** no agente de desenvolvimento **Shark Dev** (`shark-ai`), com foco na **Abordagem C (Compactação Asíncrona/Lote)**.

O objetivo é substituir o acúmulo linear de histórico por um modelo de memória episódica (Memboxes) e temática (Traces), evitando a saturação da janela de contexto do LLM de forma eficiente e sem acrescentar latência nas interações imediatas.

---

## 1. Visão Geral da Arquitetura

O sistema de memória Membox no Shark Dev será composto por dois módulos principais:
1. **Topic Loom (Lote)**: Analisa o histórico bruto conversacional e segmenta-o retroativamente em caixas de episódios locais de contexto chamadas `Memboxes`.
2. **Trace Weaver (Global)**: Extrai eventos dessas caixas e costura-os em linhas temáticas de longo prazo chamadas `Traces`.

```
[Fluxo de Chamadas do Shark Dev]
         │
         ▼
[Verificar Tamanho do Histórico Bruto]
         │
         ├─► < 8.000 tokens: Envia o histórico linear bruto (Latência Zero)
         │
         └─► >= 8.000 tokens (Compactação):
               1. Bloqueia momentaneamente a execução do loop
               2. Roda Topic Loom e Event Extraction em lote sobre mensagens antigas
               3. Envia novos eventos para o Trace Weaver
               4. Salva caixas em boxes.jsonl e traces em traces.jsonl
               5. Trunca o histórico bruto (mantendo os últimos ~1.500 tokens)
         │
         ▼
[Montagem de Prompt] ──► Recupera Caixas e Traces relevantes + Mensagens cruas recentes
         │
         ▼
[Enviar para LLM]
```

---

## 2. Estruturas de Dados e Persistência

Os arquivos serão armazenados localmente no diretório `.shark/membox/` do projeto.

### A. Caixas de Tópicos (`.shark/membox/boxes.jsonl`)
Cada linha deste arquivo representa um episódio de execução consolidado:
```json
{
  "box_id": 1,
  "start_time": "2026-06-30T03:00:00Z",
  "coverage": {
    "session_id": "session_1",
    "start_step": 1,
    "end_step": 5
  },
  "content_text": "User: O teste de UUID está falhando.\nAssistant: Vou verificar o schema.ts...\n[Tool Output]: npm run test failed...",
  "features": {
    "topic": "Depuração do schema de validação UUID",
    "keywords": ["schema", "uuid", "zod", "validação"],
    "events": [
      "Identificou falha no teste de validação de UUID",
      "Analisou o arquivo src/core/config/schema.ts",
      "Corrigiu a expressão regular de UUID"
    ],
    "events_text": "Identificou falha no teste de validação de UUID | Analisou o arquivo src/core/config/schema.ts | Corrigiu a expressão regular de UUID"
  }
}
```

### B. Linhas Temáticas (`.shark/membox/traces.jsonl`)
Cada linha representa um histórico temático de longo prazo:
```json
{
  "trace_id": 0,
  "box_ids": [1, 5],
  "entries": [
    {
      "box_id": 1,
      "start_time": "2026-06-30T03:00:00Z",
      "events": ["Identificou falha no teste de validação de UUID", "Corrigiu a expressão regular de UUID"],
      "order": 0
    },
    {
      "box_id": 5,
      "start_time": "2026-06-30T04:20:00Z",
      "events": ["Validou que a alteração de UUID não quebrou a integração com StackSpot"],
      "order": 1
    }
  ],
  "entries_text": "2026-06-30T03:00:00Z: Identificou falha no teste de validação de UUID Corrigiu a expressão regular de UUID 2026-06-30T04:20:00Z: Validou que a alteração de UUID não quebrou a integração com StackSpot"
}
```

### C. Armazenamento Vetorial (`.shark/membox/vectors.json`)
Mapeamento de chaves exclusivas (hashes SHA-1 do texto) para vetores de floats, gerado pelos embeddings:
```json
{
  "5a7f9b1c": [0.012, -0.043, 0.982, "... floats"]
}
```

---

## 3. Geração de Embeddings (Modelos, Cache e Similaridade)

Para realizar a busca vetorial local sem dependências pesadas ou servidores adicionais, a especificação detalha o módulo de embeddings:

### A. Estratégias de Geração
O Shark Dev suportará duas abordagens configuráveis no arquivo de configuração do projeto:

1.  **Geração em Nuvem (Cloud API)**:
    - Se o provedor configurado for `openai-compatible`, o Shark disparará requisições para o endpoint `/embeddings` (ex: utilizando o modelo `text-embedding-3-small` da OpenAI ou `nomic-embed-text` no Ollama).
    - Se o provedor for `stackspot`, utilizaremos um fallback local ou chave OpenAI compatível.
2.  **Geração Local (Offline - Totalmente Empacotada/Pre-downloaded)**:
    - Utilização da biblioteca `@xenova/transformers` para rodar o modelo `Xenova/all-MiniLM-L6-v2` (versão quantizada ONNX de ~23MB) localmente em Node.js via CPU.
    - Para garantir que a execução seja 100% isolada e sem conexões externas em ambientes restritos (air-gapped), desabilitaremos o download automático configurando a biblioteca (`env.allowRemoteModels = false`) e apontando o carregador de modelos para o diretório local do projeto em `src/resources/models/all-MiniLM-L6-v2/`.
    - Os arquivos do modelo (incluindo `config.json`, `tokenizer.json`, e `model_quantized.onnx`) serão pré-baixados e commitados diretamente no repositório de código do projeto.

### B. Mecanismo de Cache por Hash (SHA-1)
Para evitar o recalculo de embeddings e otimizar chamadas de API:
- Para cada caixa (`content_text`) ou evento extraído, geramos um hash SHA-1 curto de 16 caracteres.
- O `MemboxManager` mantém um mapa em memória carregado de `.shark/membox/vectors.json`.
- A busca e salvamento do embedding são feitos primeiro contra esse cache. O embedding só é gerado na API/modelo local se o hash não for encontrado no cache.

### C. Busca de Similaridade Matemática (Cosseno)
A busca vetorial calcula a similaridade localmente em TypeScript:

```typescript
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length) return -1;
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
```

---

## 4. Funcionamento da Pipeline de Compactação (Abordagem C)

Quando o gatilho de compactação ($\ge 8.000$ tokens) é disparado:

1. **Leitura e Fatiamento (Topic Loom)**:
   - O histórico bruto é percorrido do início ao fim usando um loop de deslizamento de turnos.
   - Chamamos o LLM (`PROMPT_MSG_CONTINUATION`) para descobrir os cortes de tópicos e agrupá-los em caixas temporárias.
2. **Extração de Metadados**:
   - Para cada nova caixa delimitada, chamamos o LLM com o `PROMPT_DIALOG_EXTRACT` para gerar o resumo de tópico, palavras-chave e a lista de eventos.
3. **Trace Weaver**:
   - Os eventos de cada caixa são computados em embeddings.
   - Fazemos uma busca vetorial de cosseno local no arquivo `vectors.json` para achar Traces candidatas.
   - O LLM (`PROMPT_TRACE_EVENT_FILTER`) decide quais eventos se agrupam às Traces antigas, e o `PROMPT_TRACE_INIT` cria novas Traces para eventos órfãos.
4. **Persistência e Truncamento**:
   - O Shark Dev salva as novas caixas e traces no banco local, e limpa a seção antiga do arquivo de log bruto.

---

## 4. Algoritmo de Recuperação (Retrieval) no Provider

1. **Embedding da Pergunta**: Gera o vetor do input atual do usuário.
2. **Busca de Caixas**: Calcula a similaridade de cosseno do input com o vetor de cada caixa salva no banco. Seleciona as $k_b = 5$ caixas mais similares.
3. **Busca de Traces**:
   - Obtém todos os eventos pertencentes às $k_b$ caixas selecionadas.
   - Seleciona os $k_e = 2$ eventos mais similares à pergunta do usuário.
   - Recupera a linha do tempo de eventos das Traces a que esses eventos pertencem.
4. **Montagem do Payload**:
   - Constrói o Prompt de Sistema contendo as seções `--- MEMÓRIA DE LONGO PRAZO: TRACES RELEVANTES ---` e `--- MEMÓRIA EPISÓDICA: CAIXAS RECUPERADAS ---`.
   - Anexa as mensagens brutas recentes remanescentes no histórico bruto truncado.
   - Envia o payload final para a API de chat.

---

## 5. Plano de Verificação

*   **Testes Unitários**: Testes unitários para validar a lógica de similaridade de cosseno e o processamento de lotes do histórico de mensagens.
*   **Mocks de API**: Utilizar dados sintéticos para simular a chamada de compactação retroativa.
