# Documento de Design: Remoção de Agentes Depreciados e Ferramentas AST

Este documento descreve o design técnico para a remoção dos agentes obsoletos e todas as ferramentas de edição baseadas em AST (Abstract Syntax Tree) do projeto **Shark AI**, mantendo exclusivamente o agente de desenvolvimento **Shark Dev**.

## Objetivos e Contexto
O objetivo é simplificar a arquitetura do projeto Shark AI, mantendo apenas as funcionalidades necessárias para o funcionamento do agente de desenvolvimento central (Shark Dev) e removendo o "peso morto" e bibliotecas depreciadas que não fazem mais sentido para a arquitetura atual do CLI.

## Mudanças Propostas

### 1. Remoção Física de Arquivos e Diretórios
Os seguintes arquivos e diretórios serão excluídos permanentemente do projeto:
* **AST-Editing:** Diretório [src/core/ast-editing](file:///d:/projetos/bmadspot/src/core/ast-editing) (contém toda a lógica de parsing e edição AST baseada em `ts-morph` e `ast-grep`).
* **Agentes Legados:**
  * [business-analyst-agent.ts](file:///d:/projetos/bmadspot/src/core/agents/business-analyst-agent.ts) e respectivo arquivo de testes.
  * [legacy-developer-agent.ts](file:///d:/projetos/bmadspot/src/core/agents/legacy-developer-agent.ts).
  * [qa-agent.ts](file:///d:/projetos/bmadspot/src/core/agents/qa-agent.ts).
  * [scan-agent.ts](file:///d:/projetos/bmadspot/src/core/agents/scan-agent.ts).
  * [specification-agent.ts](file:///d:/projetos/bmadspot/src/core/agents/specification-agent.ts).
  * [verify-ba-agent.ts](file:///d:/projetos/bmadspot/src/core/agents/verify-ba-agent.ts).
* **Comandos CLI:**
  * [legacy.ts](file:///d:/projetos/bmadspot/src/commands/legacy.ts) e respectivo teste.
  * [qa.ts](file:///d:/projetos/bmadspot/src/commands/qa.ts).
  * [scan.ts](file:///d:/projetos/bmadspot/src/commands/scan.ts).
* **Serviços de Validação:**
  * [code-review.service.ts](file:///d:/projetos/bmadspot/src/core/services/code-review.service.ts).
* **Testes Externos:**
  * [tests/verify-ast-grep.ts](file:///d:/projetos/bmadspot/tests/verify-ast-grep.ts).

### 2. Modificações e Simplificações em Arquivos Existentes

#### [MODIFY] [agent-tools.ts](file:///d:/projetos/bmadspot/src/core/agents/agent-tools.ts)
* Remover todas as funções auxiliares que utilizam AST (`astGrepSearch`, `astGrepRewrite`, `resolveAstGrepCommand` e todas as implementações `ast*` como `astListStructure`, `astAddMethod`, etc.).
* Remover a chamada a `CodeReviewService.reviewCode` dentro de `generateFilePreview` e não injetar feedback do Code Review Agent no preview do usuário.

#### [MODIFY] [schema.ts](file:///d:/projetos/bmadspot/src/core/config/schema.ts)
* Atualizar os objetos Zod `agents` e `agentVersions` para conter apenas a chave `dev: z.string().optional()`.
* Remover a chave `validation` do schema.

#### [MODIFY] [provider.interface.ts](file:///d:/projetos/bmadspot/src/core/api/provider.interface.ts)
* Alterar o tipo de `agentType` de união múltipla para aceitar apenas `'developer_agent'`.

#### [MODIFY] [provider-resolver.ts](file:///d:/projetos/bmadspot/src/core/api/provider-resolver.ts)
* Alterar a assinatura e o tipo do parâmetro `agentType` para aceitar apenas `'developer_agent'`.

#### [MODIFY] [stackspot-provider.ts](file:///d:/projetos/bmadspot/src/core/api/stackspot-provider.ts)
* Simplificar os métodos `getAgentId` e `getAgentVersion` para mapear exclusivamente o `'developer_agent'`.
* Remover os mapeamentos e as variáveis de ambiente obsoletas dos outros agentes (`STACKSPOT_BA_AGENT_ID`, etc.).

#### [MODIFY] [shark.ts](file:///d:/projetos/bmadspot/src/bin/shark.ts)
* Remover a importação de `legacyCommand` e o seu registro via `program.addCommand(legacyCommand)`.

#### [MODIFY] [init.ts](file:///d:/projetos/bmadspot/src/commands/init.ts)
* Modificar os textos de finalização recomendando a execução do comando `shark dev` (em vez de `shark agent`).

#### [MODIFY] [package.json](file:///d:/projetos/bmadspot/package.json)
* Excluir `@ast-grep/cli` e `ts-morph` da lista de `dependencies`.

---

## Plano de Validação
1. **Compilação do Projeto:** Garantir que o projeto compila sem erros (com `npm run build`).
2. **Execução de Testes:** Garantir que todos os testes remanescentes passam (com `npm test`).
3. **Validação Manual:** Testar os comandos `init` e `dev` do CLI localmente para garantir o funcionamento correto.
