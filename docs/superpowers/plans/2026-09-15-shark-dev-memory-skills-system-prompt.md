# Shark Dev Memory & Skills System Prompt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Conectar o carregamento real do snapshot de memória e o catálogo rico de skills (com frontmatter) no Shark Dev, reestruturando as instruções comportamentais do System Prompt e garantindo o repasse correto do prompt dinâmico em todos os provedores.

**Architecture:**
- `SkillManager`: Extrai `name` e `description` de `SKILL.md` (frontmatter YAML) e formata `<skills_index>` descritivo.
- `prompts.ts`: Adiciona `old_str` no schema formal de `args` e inclui a nova governança de memória (fatos declarativos, regras de manutenção, delimitação de escopo vs skills) e consulta mandatória de skills antes da implementação.
- `developer-agent.ts`: Carrega `MemoryStore.loadSnapshot()` na inicialização para preencher `<user_profile>` e `<project_memory>`, e recarrega dinamicamente após mutações de memória.
- `stackspot-provider.ts`: Corrige o bypass garantindo que `options.systemPrompt` seja repassado para o prompt final.

**Tech Stack:** TypeScript, Node.js (ESM), Vitest, Zod

## Global Constraints
- Manter compatibilidade com os schemas Zod de ferramentas existentes (`memoryToolSchema`).
- Não quebrar o envelope uniforme `{ "type": "...", "args": { ... } }`.
- Garantir que todas as alterações tenham testes unitários automatizados com Vitest.

---

### Task 1: Enriquecer `SkillManager` com Metadados de Frontmatter e Índice Formatado

**Files:**
- Modify: `src/core/workflow/skill-manager.ts`
- Test: `src/core/workflow/skill-manager.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  export interface SkillMetadata {
    name: string;
    description: string;
  }
  getAvailableSkillsMetadata(): Promise<SkillMetadata[]>;
  formatSkillsIndex(skills: SkillMetadata[]): string;
  ```

- [ ] **Step 1: Escrever testes que falham para extração de frontmatter e formatação do índice**

Adicionar testes em `src/core/workflow/skill-manager.test.ts`:
```typescript
it('deve extrair metadados (name e description) de SKILL.md com frontmatter', async () => {
    // Configurar fixture temporária de skill com YAML frontmatter
    // Chamar skillManager.getAvailableSkillsMetadata()
    // Verificar que retorna name e description
});

it('deve formatar o catálogo de skills em markdown com bullet points enriquecidos', () => {
    const skills = [
        { name: 'brainstorming', description: 'Explora ideias antes de codificar' },
        { name: 'tdd', description: 'Test driven development' }
    ];
    const formatted = skillManager.formatSkillsIndex(skills);
    expect(formatted).toContain('- **brainstorming**: Explora ideias antes de codificar');
    expect(formatted).toContain('- **tdd**: Test driven development');
});
```

- [ ] **Step 2: Executar testes para confirmar a falha**

Run: `npx vitest run src/core/workflow/skill-manager.test.ts`
Expected: FAIL com `getAvailableSkillsMetadata is not a function`

- [ ] **Step 3: Implementar extração de metadados e formatação no `SkillManager`**

Em `src/core/workflow/skill-manager.ts`:
1. Implementar método para parsear o bloco `---` no início do `SKILL.md` capturando `description` e `name`.
2. Implementar `getAvailableSkillsMetadata(): Promise<SkillMetadata[]>`.
3. Implementar `formatSkillsIndex(skills: SkillMetadata[]): string`.

- [ ] **Step 4: Executar testes para verificar se passam**

Run: `npx vitest run src/core/workflow/skill-manager.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/workflow/skill-manager.ts src/core/workflow/skill-manager.test.ts
git commit -m "feat(skills): add frontmatter metadata extraction and rich index formatting"
```

---

### Task 2: Atualizar System Prompt, Schemas e Instruções de Memória/Skills

**Files:**
- Modify: `src/core/api/prompts.ts`
- Create: `src/core/api/prompts.test.ts`

**Interfaces:**
- Consumes: `MemorySnapshot` de `src/core/memory/memory-store.ts`
- Produces:
  - `TOOL_ARGS_PROPERTIES.old_str`
  - `COORDINATOR_RESPONSE_JSON_SCHEMA` atualizado
  - `buildUnifiedSystemPrompt(options?: BuildPromptOptions): string` com diretrizes do Hermes

- [ ] **Step 1: Escrever testes unitários em `prompts.test.ts`**

Criar `src/core/api/prompts.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { buildUnifiedSystemPrompt, COORDINATOR_RESPONSE_JSON_SCHEMA, TOOL_ARGS_PROPERTIES } from './prompts.js';

describe('prompts', () => {
    it('deve incluir old_str nas propriedades de TOOL_ARGS_PROPERTIES', () => {
        expect(TOOL_ARGS_PROPERTIES).toHaveProperty('old_str');
    });

    it('deve renderizar <user_profile> e <project_memory> quando snapshot for fornecido', () => {
        const prompt = buildUnifiedSystemPrompt({
            snapshot: {
                user: 'User pref',
                memory: 'Repo conventions',
                soul: 'Custom soul',
                memoryUsage: { current: 10, max: 2200, percentage: 1 },
                userUsage: { current: 10, max: 1375, percentage: 1 },
                composedPromptBlock: ''
            }
        });
        expect(prompt).toContain('<user_profile>\nUser pref\n</user_profile>');
        expect(prompt).toContain('<project_memory>\nRepo conventions\n</project_memory>');
        expect(prompt).toContain('DECLARATIVA');
    });

    it('deve conter regras mandatórias de consulta e ativação de skills', () => {
        const prompt = buildUnifiedSystemPrompt({ skillsIndex: '- **test**: desc' });
        expect(prompt).toContain('<skills_index>');
        expect(prompt).toContain('activate_skill');
        expect(prompt).toContain('REGRA DE CONSULTA ANTES DA AÇÃO');
    });
});
```

- [ ] **Step 2: Executar testes para confirmar falha**

Run: `npx vitest run src/core/api/prompts.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar melhorias em `prompts.ts`**

1. Adicionar `old_str` em `TOOL_ARGS_PROPERTIES`.
2. Inserir os blocos completos de diretrizes de Memória (Declarativa vs Imperativa, Limites, Ações `add`/`replace`/`remove`/`read`, `session_search`).
3. Inserir bloco de Skills (Regra de consulta mandatória antes de ação e injeção em `<EXTREMELY_IMPORTANT>`).

- [ ] **Step 4: Executar testes para validar sucesso**

Run: `npx vitest run src/core/api/prompts.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/api/prompts.ts src/core/api/prompts.test.ts
git commit -m "feat(prompts): update memory and skills guidance and add old_str to schema"
```

---

### Task 3: Corrigir Repasse de `systemPrompt` no `StackSpotProvider`

**Files:**
- Modify: `src/core/api/stackspot-provider.ts`
- Test: `src/core/api/stackspot-provider.test.ts`

**Interfaces:**
- Consumes: `options.systemPrompt` em `streamChat(prompt, options)`

- [ ] **Step 1: Escrever teste em `stackspot-provider.test.ts` para validar o uso de `options.systemPrompt`**

Verificar se ao passar `{ systemPrompt: 'CUSTOM_SYSTEM_PROMPT' }`, o prompt enviado à API contém `CUSTOM_SYSTEM_PROMPT`.

- [ ] **Step 2: Executar teste para confirmar falha**

Run: `npx vitest run src/core/api/stackspot-provider.test.ts`
Expected: FAIL (pois usa `UNIFIED_SYSTEM_PROMPT` fixo)

- [ ] **Step 3: Implementar a correção em `stackspot-provider.ts`**

Alterar as linhas onde `systemPrompt` é inicializado:
```typescript
const isSubagent = !!process.env.SHARK_SUBAGENT_ROLE;
let systemPrompt = options.systemPrompt || (isSubagent ? SUBAGENT_SYSTEM_PROMPT : UNIFIED_SYSTEM_PROMPT);
```
Garantir que `staticSystem` e `compiledPrompt` usem esse valor.

- [ ] **Step 4: Executar testes para confirmar aprovação**

Run: `npx vitest run src/core/api/stackspot-provider.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/api/stackspot-provider.ts src/core/api/stackspot-provider.test.ts
git commit -m "fix(provider): honor dynamic systemPrompt in stackspot-provider"
```

---

### Task 4: Integrar Carregamento e Reatividade de Memória/Skills no `DeveloperAgent`

**Files:**
- Modify: `src/core/agents/developer-agent.ts`
- Test: `src/core/agents/developer-agent.test.ts`

**Interfaces:**
- Consumes: `MemoryStore`, `skillManager.getAvailableSkillsMetadata()`, `skillManager.formatSkillsIndex()`

- [ ] **Step 1: Escrever teste em `developer-agent.test.ts` garantindo que o snapshot de memória é passado ao provider**

Adicionar teste verificando que o `provider.streamChat` recebe `systemPrompt` contendo o conteúdo do snapshot de memória carregado do `MemoryStore`.

- [ ] **Step 2: Executar teste para verificar falha inicial**

Run: `npx vitest run src/core/agents/developer-agent.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar carregamento e reatividade no `developer-agent.ts`**

1. No início de `interactiveDeveloperAgent`:
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
2. No tratamento de `action.type === 'memory'`:
   Quando a ação for executada com sucesso, recarregar `memorySnapshot` e atualizar `dynamicSystemPrompt`:
   ```typescript
   if (['add', 'replace', 'remove'].includes(memArgs.action)) {
       memorySnapshot = await memoryStore.loadSnapshot();
       dynamicSystemPrompt = buildUnifiedSystemPrompt({
           snapshot: memorySnapshot,
           toolsCatalog: mcpManifest,
           skillsIndex
       });
   }
   ```

- [ ] **Step 4: Executar testes para confirmar que passam**

Run: `npx vitest run src/core/agents/developer-agent.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/agents/developer-agent.ts src/core/agents/developer-agent.test.ts
git commit -m "feat(agent): load memory snapshot and update system prompt dynamically"
```

---

### Task 5: Verificação Geral da Suíte de Testes

- [ ] **Step 1: Rodar a suíte completa de testes unitários**

Run: `npm test`
Expected: Todos os testes passando sem regressão.

- [ ] **Step 2: Commit final de integração**

```bash
git commit --allow-empty -m "chore: verify full test suite passes with memory and skills prompt integration"
```
