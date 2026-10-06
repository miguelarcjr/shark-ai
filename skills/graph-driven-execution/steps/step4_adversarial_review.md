# Step 4: Adversarial Code & Security Review

## Goal
Scrutinize the real git diff produced in the worktree against design specifications and task plan, evaluating security flaws, blast radius, test rigor, and contract adherence with an objective 0 to 10.0 scoring rubric.

## Rubrica de Avaliação do Diff (0 a 10.0 pontos)
1. **Contratos & Requisitos da Tarefa (Max: 4.0 pontos)**
   - Implementação exata do comportamento prescrito na tarefa sem alterar contratos não autorizados (2.0 pts)
   - Todos os cenários e edge cases do AC correspondente contemplados (2.0 pts)
2. **Segurança & Resiliência (Max: 3.0 pontos)**
   - Ausência de injeção, memory leaks, unhandled exceptions, race conditions, overflow (2.0 pts)
   - Validações estritas de boundaries, types e erros (1.0 pt)
3. **Rigor dos Testes & TDD (Max: 2.0 pontos)**
   - Testes reais sem asserções tautológicas ou mocks que mascarem a lógica real (1.0 pt)
   - Asserções completas sobre valores e mensagens de erro esperadas (1.0 pt)
4. **Blast Radius & Limpeza (Max: 1.0 ponto)**
   - Modificações estritamente restritas aos arquivos autorizados da tarefa (`allowedFiles`), sem arquivos espúrios ou código morto (1.0 pt)

## Tiers de Decisão
- **Faixa 9.0 a 10.0 (PASS):** Aprovado diretamente para commit atômico (`ATOMIC_COMMIT`).
- **Faixa 7.0 a 8.9 (PASS WITH WARNINGS):** Aprovado **SEM ROLLBACK**. Sugestões e ressalvas anotadas como `- [WARN-xx] <descrição>`.
- **Faixa 0.0 a 6.9 (BLOCKER):** Reprovado. Dispara rollback para `GREEN_CODE` com motivo técnico exato para correção.

## Actions for the Coordinator
1. **Generate Brief:**
   - Run: `node "${SHARK_SKILL_DIR}/scripts/exec-ctl.mjs" brief code-reviewer`
   - The brief automatically embeds the live `git diff` from the worktree, the task plan, and the scoring rubric.
2. **Dispatch Code Reviewer:**
   - Use `invoke_subagent` with:
     - `role`: "code-reviewer"
     - `task_file`: `.shark/specs/<spec-id>/briefs/exec-code-reviewer-task-<N>.md`
3. **Handle Verdict:**
   - **If VERDICT: BLOCKER:**
     - Execute rollback:
       `node "${SHARK_SKILL_DIR}/scripts/exec-ctl.mjs" rollback --to GREEN_CODE --reason "<review feedback>"`
     - Re-dispatch `tdd-dev` to fix the implementation.
   - **If VERDICT: PASS or PASS WITH WARNINGS:**
     - Run: `node "${SHARK_SKILL_DIR}/scripts/exec-ctl.mjs" transition --next`
     - Proceed to `step5_atomic_commit.md`.

