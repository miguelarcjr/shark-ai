# Design Specification: Shark Dev Memory and Skills System Prompt Integration

- **Data**: 2026-09-15
- **Status**: Validado com Usuário (Aprovado)
- **Escopo**: Sistema de Memória, Indexação de Skills, Governança no System Prompt e Provedores LLM

---

## 1. Contexto e Problema

Uma análise forense da implementação do Shark Dev ([developer-agent.ts](file:///d:/projetos/bmadspot/src/core/agents/developer-agent.ts), [prompts.ts](file:///d:/projetos/bmadspot/src/core/api/prompts.ts), [memory-store.ts](file:///d:/projetos/bmadspot/src/core/memory/memory-store.ts), [skill-manager.ts](file:///d:/projetos/bmadspot/src/core/workflow/skill-manager.ts), [stackspot-provider.ts](file:///d:/projetos/bmadspot/src/core/api/stackspot-provider.ts)) identificou quatro falhas críticas:

1. **Memória Desconectada no Runtime**:
   - `MemoryStore.loadSnapshot()` nunca era invocado pelo agente. Como resultado, os blocos `<user_profile>` e `<project_memory>` permaneciam 100% vazios no prompt do agente.
   - O agente não recebia na inicialização o perfil do desenvolvedor nem as convenções persistidas do projeto.
2. **Índice de Skills Empobrecido**:
   - `skillManager.listAvailableSkills()` retornava apenas os nomes das pastas das skills (ex: `- brainstorming`), sem descrições ou finalidades. O LLM não conseguia inferir quando ou por que ativar uma skill.
3. **Lacunas no System Prompt e Schemas**:
   - O System Prompt continha apenas uma linha rasa mencionando a ferramenta `memory`, sem explicar `target` (`memory` vs `user`), a regra de ouro de fatos declarativos vs imperativos, limites de caracteres e ações de manutenção (`old_str`, `replace`, `remove`, `read`).
   - `old_str` estava ausente do `TOOL_ARGS_PROPERTIES` no schema JSON formal.
   - A instrução de `activate_skill` não possuía regras comportamentais mandatórias antes da ação de código.
4. **Bypass no Provider StackSpot**:
   - Em `stackspot-provider.ts`, `options.systemPrompt` era ignorado e substituído pela constante estática `UNIFIED_SYSTEM_PROMPT`, descartando `<skills_index>`, catálogos MCP e snapshots dinâmicos.

Inspirando-se nos padrões de governança do **Hermes Agent** (`prompt_builder.py`), este design especifica a modernização completa da injeção e governança de memória e skills no Shark Dev.

---

## 2. Arquitetura e Componentes

### 2.1. Extração Rica de Skills com Frontmatter (`skill-manager.ts`)

O `SkillManager` passa a analisar o YAML frontmatter dos arquivos `SKILL.md` locais e globais:

- **Nova Interface de Skill**:
  ```typescript
  export interface SkillMetadata {
    name: string;
    description: string;
  }
  ```
- **Novo Método `getAvailableSkillsMetadata()`**:
  - Lê cada `SKILL.md`.
  - Extrai `name` e `description` via parsing seguro de frontmatter (delimitado por `---`).
  - Retorna a lista de metadados ordenada por nome.
- **Novo Método `formatSkillsIndex()`**:
  - Converte os metadados em formato de catálogo legível:
    ```markdown
    - **brainstorming**: You MUST use this before any creative work - creating features, building components...
    - **test-driven-development**: Use when implementing any feature or bugfix, before writing implementation code...
    ```

---

### 2.2. Governança e System Prompt Reestruturado (`prompts.ts`)

#### 2.2.1. Instruções Comportamentais de Memória
Substituir a menção simplificada por diretrizes explícitas inspiradas no Hermes Agent:

```markdown
🧠 SISTEMA DE MEMÓRIA PERSISTENTE E APRENDIZADO:
Você possui memória persistente que é carregada em todas as sessões. Use a ação 'memory' para registrar fatos que você deve lembrar no futuro:

1. DIFERENÇA ENTRE OS ALVOS ('target'):
   - target: 'memory' (Memória do Projeto): Fatos duráveis sobre este repositório que afetam qualquer tarefa futura (ex: convenções de arquitetura, stack adotada, comandos de build/test específicos, decisões tomadas).
   - target: 'user' (Perfil do Usuário): Preferências perenes do desenvolvedor (ex: idioma preferido, preferências de formatação ou de estilo de código).

2. REGRA DE OURO DOS FATOS (Declarativo vs Imperativo):
   - SEMPRE registre fatos de forma DECLARATIVA:
     ✓ "O projeto utiliza Vitest com ESM para testes unitários."
     ✓ "O usuário prefere explicações concisas e código direto."
   - NUNCA registre instruções IMPERATIVAS:
     ✗ "Sempre execute vitest nos testes." (Frases imperativas podem ser interpretadas no futuro como uma ordem absoluta que sobrescreve o pedido atual do usuário).

3. ORÇAMENTO DE ESPAÇO E MANUTENÇÃO:
   - A memória tem orçamento finito de caracteres (MEMORY: 2200 chars, USER: 1375 chars). Não acumule redundâncias.
   - Quando uma convenção mudar ou a memória encher, use:
     - action: 'replace', com 'old_str': "trecho exato antigo" e 'content': "trecho novo atualizado".
     - action: 'remove', com 'old_str': "trecho exato a remover".
   - action: 'read': Permite ler o arquivo bruto caso precise inspecionar as entradas atuais.

4. O QUE NÃO PERTENCE À MEMÓRIA:
   - Procedimentos detalhados passo-a-passo, checklists e fluxos de tarefas NÃO vão para a memória — eles pertencem às SKILLS.
   - Detalhes temporários de uma única tarefa pertencem ao histórico da sessão.

🔍 BUSCA EM CONVERSAS PASSADAS ('session_search'):
- Se o usuário fizer referência a algo discutido em sessões passadas (ex: "como fizemos naquele bug anterior?", "lembra daquela configuração?"), USE 'session_search' com args: { "query": "termo de busca", "limit": 5 } antes de pedir para o usuário se repetir.
```

#### 2.2.2. Instruções de Ativação Proativa de Skills
```markdown
⚡ CATÁLOGO DE SKILLS E ESPECIALIZAÇÃO TÉCNICA:
Em <skills_index> estão listadas as habilidades e diretrizes técnicas disponíveis neste ambiente, com suas descrições e objetivos.

1. REGRA DE CONSULTA ANTES DA AÇÃO:
   - Ao receber uma tarefa técnica (planejamento, criação de funcionalidade, testes, depuração, revisão), você DEVE consultar o <skills_index>.
   - Se houver uma skill relevante para a tarefa solicitada, execute IMEDIATAMENTE a ação:
     { "type": "activate_skill", "args": { "name": "nome_da_skill" } }
     antes de começar a escrever arquivos ou executar comandos de implementação.

2. APLICAÇÃO DAS DIRETRIZES:
   - Ao ativar uma skill, suas diretrizes especializadas serão injetadas no seu contexto prioritário (<EXTREMELY_IMPORTANT>). Você deve seguir rigorosamente as regras da skill ativada durante toda a execução daquela tarefa.
```

#### 2.2.3. Atualização de Schemas
Adicionar `old_str` em `TOOL_ARGS_PROPERTIES`:
```typescript
old_str: {
  type: "string",
  description: "Trecho exato a ser substituído em 'replace' ou excluído em 'remove' na ação de memory."
}
```

---

### 2.3. Loop de Execução e Injeção do Snapshot (`developer-agent.ts`)

1. **Inicialização com Snapshot Real**:
   ```typescript
   const memoryStore = new MemoryStore();
   let memorySnapshot = await memoryStore.loadSnapshot();

   const skillsMetadata = await skillManager.getAvailableSkillsMetadata();
   const skillsIndex = skillManager.formatSkillsIndex(skillsMetadata);

   let dynamicSystemPrompt = buildUnifiedSystemPrompt({
       snapshot: memorySnapshot,
       toolsCatalog: mcpManifest,
       skillsIndex
   });
   ```
2. **Atualização Dinâmica no Sucesso da Tool `memory`**:
   - Quando `action.type === 'memory'` for executado com sucesso e modificar estado (`add`, `replace`, `remove`), recarregar `memorySnapshot = await memoryStore.loadSnapshot()` e recalcular `dynamicSystemPrompt`.

---

### 2.4. Respeito ao System Prompt no Provedor StackSpot (`stackspot-provider.ts`)

No método `streamChat`:
```typescript
const isSubagent = !!process.env.SHARK_SUBAGENT_ROLE;
let systemPrompt = options.systemPrompt || (isSubagent ? SUBAGENT_SYSTEM_PROMPT : UNIFIED_SYSTEM_PROMPT);
```
Garantir que tanto na montagem de `rawHistory` (quando vazio) quanto no `compiledPrompt` (para o modo não-servidor e primeiro turno com servidor), `systemPrompt` use o `options.systemPrompt` gerado dinamicamente pelo orquestrador.

---

## 3. Plano de Verificação e Testes

1. **Testes Unitários de Skills**:
   - Testar extração de metadados em `skillManager.getAvailableSkillsMetadata()`, cobrindo skills com e sem YAML frontmatter.
   - Testar formatação de `skillManager.formatSkillsIndex()`.
2. **Testes Unitários de Prompts e Schemas**:
   - Validar que `buildUnifiedSystemPrompt({ snapshot })` inclui as tags `<user_profile>` e `<project_memory>` preenchidas com o snapshot.
   - Validar que `COORDINATOR_RESPONSE_JSON_SCHEMA` aceita `old_str` em `args`.
3. **Testes do StackSpot Provider**:
   - Validar que `streamChat` propaga `options.systemPrompt` para o payload da requisição.
4. **Teste End-to-End no Developer Agent**:
   - Verificar se ao iniciar uma tarefa, o `dynamicSystemPrompt` carrega o snapshot de memória e o catálogo com descrições das skills.
