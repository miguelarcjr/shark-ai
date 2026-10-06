# Gate Criteria & Quality Gates

This reference document defines the strict, non-negotiable criteria enforced by `spec-ctl.mjs validate` and `transition`.

## 0. Gate 0: Multi-Source Context Grounding (`CONTEXT_GROUNDING`)

- **Responsible Subagent:** `Multi-Source Context Grounder` (`researcher`)
- **Output Artifact:** `.shark/specs/<spec-id>/artifacts/context-pack.md`
- **Mandatory Sections:**
  - `# Context Pack`: Synthesis and overview of ingested materials.
  - `1. Regras de Negocio`: Concrete business rules (`BR-xx`) extracted from documentation or code.
  - `2. Matriz de Conflitos`: Contradictions or discrepancies between sources (`[CONF-xx]`).
- **Enforcement Rules:**
  - If sources were added via `spec-ctl.mjs source add`, the artifact must be produced with all required sections.
  - If zero sources were registered, an auto-seeded baseline is accepted.
  - Extracted conflicts are automatically forwarded into the Product Analyst briefing.

---

## 1. Gate 1: Requirements & Clarity Gate (`DISCOVERY_ELICITATION`)

- **Responsible Subagent:** `Product Analyst`
- **Output Artifact:** `.shark/specs/<spec-id>/artifacts/brief.md`
- **Mandatory Sections:**
  - `# Problem`: Clear narrative of what problem is being solved and why.
  - `# Scope`: Explicit bullet points of what is **IN SCOPE** and what is **OUT OF SCOPE**.
  - `# Acceptance Criteria`: Measurable, testable scenarios (Given/When/Then or verifiable checklist).
- **Prohibited Patterns:**
  - Unresolved markers: `[TODO]`, `[TBD]`, `FIXME`, or vague promises ("will be defined later").
- **Human Alignment:**
  - The coordinator must obtain explicit user confirmation before triggering `transition --next`.

---

## 2. Gate 2: Empirical Spikes & Hypothesis Verification (`HYPOTHESIS_SPIKES`)

- **Responsible Subagent:** `Spike Tester` (`spike-tester`)
- **Output Artifact:** `.shark/specs/<spec-id>/artifacts/spikes.md`
- **Mandatory Sections:**
  - `# Empirical Spikes`: Description of targeted code spikes, micro-benchmarks, or API sanity checks.
  - `# Hypotheses Evaluation`: Table or list of tested hypotheses with their resolution (`CONFIRMED` or `REFUTED`).
  - `# Findings`: Architectural implications discovered during empirical execution.
- **Enforcement Rules:**
  - All hypotheses registered in `state.hypotheses` must be resolved (none with status `PENDING`).
  - If no hypotheses were explicitly raised, an auto-seeded baseline confirmation in `spikes.md` is accepted.
  - Resolved evidence is automatically forwarded into the System Architect briefing.

---

## 3. Gate 3: Technical Architecture Gate (`TECHNICAL_ARCHITECTURE`)

- **Responsible Subagent:** `System Architect`
- **Output Artifact:** `.shark/specs/<spec-id>/artifacts/design.md`
- **Mandatory Sections:**
  - `# Architecture`: High-level component decomposition, interaction diagrams or data flow.
  - `# Affected Files`: Exhaustive list of files to create, modify, or delete, with short rationale.
  - `# Interfaces and Data Contracts`: TypeScript signatures, schema shapes, and error-handling strategies.
- **Linter Checks:**
  - Referenced existing files must actually exist in the repository.
  - Any new file paths must adhere to repo structure conventions (`src/core/...`, `skills/...`, etc.).
  - Zero `TODO` or placeholder implementations.

---

## 4. Gate 4: Adversarial Resilience Gate (`ADVERSARIAL_CRITIQUE`)

- **Responsible Subagent:** `Red Team / Adversarial Reviewer` (`reviewer`)
- **Output Artifact:** `.shark/specs/<spec-id>/artifacts/critique.md`
- **Mandatory Sections:**
  - `# Risk Analysis`: Concurrency, failure modes, network interruptions, error boundaries.
  - `# Edge Cases`: Exhaustive list of edge conditions (empty inputs, precision limits, boundary values).
  - `# Score Breakdown`: Weighted score across the 4 evaluation dimensions (total 10.0 points).
  - `# Audit Verdict`: Must explicitly declare `SCORE: <X.X>/10` and one of the verdicts below.

### Rubrica de Avaliação e Pesos (Total 10.0 pontos):
1. **Arquitetura, Modularidade & Contratos (4.0 pontos)**
   - Modularidade e baixo acoplamento (1.0 pt)
   - Tipagem TypeScript estrita e schemas de validação explícitos (1.5 pts)
   - Alinhamento rigoroso com padrões e utilitários existentes na codebase (1.5 pts)
2. **Segurança, Resiliência & Error Boundaries (3.0 pontos)**
   - Ausência de vulnerabilidades críticas, memory leaks ou vazamento de segredos (1.5 pts)
   - Tratamento de exceções, degradação graciosa e timeouts explícitos (1.5 pts)
3. **Casos de Borda & Robustez Lógica/Numérica (2.0 pontos)**
   - Limites numéricos, divisão por zero, centavos e precisão IEEE-754 (1.0 pt)
   - Inputs vazios, nulos, strings longas ou caracteres especiais (1.0 pt)
4. **Testabilidade & Viabilidade TDD (1.0 ponto)**
   - Facilidade de isolamento e determinismo em testes unitários/integrados (1.0 pt)

### O que Cada Faixa Representa:
- **Faixa 9.0 a 10.0 — EXCELENTE (`VERDICT: PASS`):**
  - *Significado:* Design impecável, robusto e sem pontas soltas críticas.
  - *Ação no Grafo:* Gate aprovado imediatamente. Avança para a decomposição TDD.
- **Faixa 7.0 a 8.9 — BOM COM RESSALVAS (`VERDICT: PASS WITH WARNINGS`):**
  - *Significado:* Design viável e sólido. Apresenta pequenos casos de borda omissos ou sugestões defensivas que **NÃO justificam rollback** e retrabalho de arquitetura.
  - *Ação no Grafo:* Gate aprovado **SEM ROLLBACK**. As ressalvas (`- [WARN-xx] ...`) são automaticamente injetadas no briefing do Planejador (`planner`), tornando-se requisitos obrigatórios de teste no plano TDD.
- **Faixa 0.0 a 6.9 — CRÍTICO / INSUFICIENTE (`VERDICT: BLOCKER: <motivo>`):**
  - *Significado:* Falhas arquiteturais graves, riscos de segurança, contratos quebrados ou contradições insolúveis.
  - *Ação no Grafo:* Gate **BLOQUEADO**. Dispara rollback para `TECHNICAL_ARCHITECTURE` com a lista de correções obrigatórias para o Arquiteto.

---

## 5. Gate 5: Implementation Readiness Gate (`TDD_PLAN_DECOMPOSITION`)

- **Responsible Subagent:** `Lead Planner` (`planner`)
- **Output Artifact:** `.shark/specs/<spec-id>/artifacts/plan.md`
- **Mandatory Sections:**
  - `# Implementation Plan`: Overview of strategy and execution sequence.
  - Sequential Tasks (`### Task 1: ...`, `### Task 2: ...`):
    - Atomic size: 2 to 5 minutes each.
    - Explicit TDD cycle:
      1. Write the failing test.
      2. Verify failure.
      3. Implement minimal code.
      4. Verify all tests pass.
      5. Commit message.
- **Handoff Compatibility:**
  - The structure must be 100% compatible with `skills/subagent-driven-development-lite`.

---

## 6. Gate 6: Plan Quality & Traceability Audit (`PLAN_AUDIT`)

- **Responsible Subagent:** `Plan Auditor` (`plan-auditor`)
- **Output Artifact:** `.shark/specs/<spec-id>/artifacts/plan-critique.md`
- **Mandatory Sections:**
  - `# Plan Audit`: Executive summary of plan feasibility, safety, and adherence to requirements.
  - `# Coverage Matrix`: Explicit cross-mapping from every Acceptance Criterion (`brief.md`) and Architectural Contract (`design.md`) to a corresponding Task and test.
  - `# Dependency & Order Review`: Verification that tasks are strictly sequential with zero forward references.
  - `# Score Breakdown`: Weighted score across the 4 evaluation dimensions (total 10.0 points).
  - `# Audit Verdict`: Must explicitly declare `SCORE: <X.X>/10` and one of the verdicts below.

### Rubrica de Avaliação e Pesos (Total 10.0 pontos):
1. **Cobertura de Requisitos & Contratos (4.0 pontos)**
   - Mapeamento 1:1 de todos os Critérios de Aceitação de `brief.md` em tarefas com testes (2.0 pts)
   - Todos os schemas, tipos e error boundaries de `design.md` contemplados nas tarefas (2.0 pts)
2. **Rigor TDD & Determinismo (3.0 pontos)**
   - Cada tarefa especifica o teste que falha primeiro, asserções objetivas e comando de verificação (ex: `npm test`) (2.0 pts)
   - Ausência de tarefas sem testes ou que acumulam código sem validação (1.0 pt)
3. **Sequenciamento & Atomicidade (2.0 pontos)**
   - Ordem estritamente sequencial sem forward-references (tarefa N não depende da tarefa N+1) (1.0 pt)
   - Granularidade atômica (2 a 5 minutos por tarefa) (1.0 pt)
4. **Realismo de Arquivos & Padrões (1.0 ponto)**
   - Caminhos de arquivos criados/editados aderentes à codebase existente e convenções do repo (1.0 pt)

### O que Cada Faixa Representa:
- **Faixa 9.0 a 10.0 — EXCELENTE (`VERDICT: PASS`):**
  - *Significado:* Plano impecável, cobertura total de requisitos e TDD rigoroso.
  - *Ação no Grafo:* Aprovado imediatamente. Avança para a execução (`READY_FOR_EXECUTION` / worktree).
- **Faixa 7.0 a 8.9 — VIÁVEL COM RESSALVAS (`VERDICT: PASS WITH WARNINGS`):**
  - *Significado:* Plano sólido e seguro. Apresenta apenas sugestões defensivas ou pequenos refinamentos que **NÃO justificam rollback** de plano.
  - *Ação no Grafo:* Aprovado **SEM ROLLBACK**. As ressalvas (`- [WARN-xx] ...`) são salvas no estado e repassadas aos desenvolvedores durante a execução.
- **Faixa 0.0 a 6.9 — CRÍTICO / INSUFICIENTE (`VERDICT: BLOCKER: <motivo>`):**
  - *Significado:* O plano ignora critérios essenciais, pula testes TDD obrigatórios ou possui dependências circulares.
  - *Ação no Grafo:* Gate **BLOQUEADO**. Dispara rollback para `TDD_PLAN_DECOMPOSITION` para o Lead Planner reestruturar o plano.

