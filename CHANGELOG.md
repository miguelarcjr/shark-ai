# Changelog

Todas as mudanças notáveis neste projeto serão documentadas neste arquivo.

O formato é baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/),
e este projeto adere ao [Semantic Versioning](https://semver.org/lang/pt-BR/).

## [Unreleased]

### Planejado
- Plugin para VS Code
- Integração com CI/CD
- Suporte para Vue.js e Svelte
- Interface web para visualizar workflows
- Analytics dashboard

---

## [0.0.1] - 2026-01-12

### Adicionado
- 🎉 Release inicial do Shark AI
- Autenticação OAuth 2.0 com StackSpot AI
- Comando `shark login` para autenticação
- Comando `shark init` para inicialização de workflows
- Comando `shark config` para gerenciamento de configurações
- Comando `shark ba` (Business Analyst Agent)
- Comando `shark spec` (Specification Agent)
- Comando `shark dev` (Developer Agent)
- Comando `shark qa` (QA Agent)
- Comando `shark scan` para análise de projetos
- Orquestração multi-agente (Business Analyst → Specification → Architect → Developer)
- Persistência de estado via `shark-workflow.json`
- Auto-healing com até 5 tentativas de correção automática
- Integração nativa com StackSpot AI Knowledge Sources
- Interface TUI rica com cores, spinners e feedback visual
- Suporte para React, Next.js e Angular
- Armazenamento seguro de tokens usando keychain do SO
- Detecção de modo offline
- Crash recovery com logging automático
- README em português e inglês
- Documentação completa de comandos e casos de uso

### Segurança
- Tokens armazenados de forma segura no keychain do OS
- .gitignore configurado para prevenir commit de secrets
- Comunicação restrita à API StackSpot (SOC2 compliant)

---

## Tipos de Mudanças

- `Adicionado` para novas funcionalidades
- `Modificado` para mudanças em funcionalidades existentes
- `Descontinuado` para funcionalidades que serão removidas
- `Removido` para funcionalidades removidas
- `Corrigido` para correções de bugs
- `Segurança` para vulnerabilidades corrigidas

---

[Unreleased]: https://github.com/miguelarcjr/shark-ai/compare/v0.0.1...HEAD
[0.0.1]: https://github.com/miguelarcjr/shark-ai/releases/tag/v0.0.1
