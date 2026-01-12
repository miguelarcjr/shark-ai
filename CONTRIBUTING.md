# Contribuindo para o Shark AI

Obrigado por considerar contribuir para o Shark AI! 🦈

Este documento fornece diretrizes para contribuir com o projeto.

---

## 📋 Código de Conduta

Ao participar deste projeto, você concorda em manter um ambiente respeitoso e acolhedor para todos.

---

## 🐛 Reportando Bugs

Se você encontrou um bug, por favor:

1. **Verifique** se o bug já não foi reportado em [Issues](https://github.com/miguelarcjr/shark-ai/issues)
2. **Crie uma issue** com o template de bug report
3. **Inclua:**
   - Descrição clara do problema
   - Passos para reproduzir
   - Comportamento esperado vs observado
   - Versão do Node.js e do Shark AI
   - Logs relevantes (censurar tokens/credenciais)

**Exemplo:**
```
Bug: Auto-healing falha após 3 tentativas

Passos para reproduzir:
1. shark init
2. Selecionar Next.js
3. Criar componente com erro de sintaxe proposital
4. Observar que auto-healing para após 3 tentativas

Esperado: Deve tentar 5 vezes
Observado: Para após 3 tentativas

Versão: Node v20.10.0, shark-ai@0.0.1
```

---

## 💡 Sugerindo Features

Para sugerir uma nova funcionalidade:

1. **Verifique** se já não foi sugerida em [Issues](https://github.com/miguelarcjr/shark-ai/issues)
2. **Crie uma issue** com o template de feature request
3. **Descreva:**
   - Problema que a feature resolve
   - Solução proposta
   - Alternativas consideradas
   - Impacto potencial

---

## 🔧 Pull Requests

### Setup do Ambiente

1. **Fork** o repositório
2. **Clone** seu fork:
   ```bash
   git clone https://github.com/SEU-USUARIO/shark-ai.git
   cd shark-ai
   ```
3. **Instale** as dependências:
   ```bash
   npm install
   ```
4. **Crie** um branch para sua feature:
   ```bash
   git checkout -b feature/minha-feature
   ```

### Desenvolvimento

1. **Faça** suas mudanças
2. **Teste** localmente:
   ```bash
   npm run build
   npm test
   ```
3. **Teste** a instalação global:
   ```bash
   npm pack
   npm install -g ./shark-ai-*.tgz
   shark --version
   ```

### Coding Standards

- **TypeScript** estrito (sem `any` desnecessários)
- **ESM** (ES Modules) - use `import/export`
- **Comentários** em português ou inglês (consistência)
- **Nomes** descritivos para variáveis e funções
- **Testes** para novas funcionalidades

**Estrutura de diretórios:**
```
src/
├── bin/           # CLI entry point
├── commands/      # Command implementations
├── core/          # Core logic (agents, config, error handling)
└── ui/            # UI components (colors, spinners, prompts)
```

### Commit Messages

Use mensagens claras e descritivas:

```
feat: adiciona suporte para framework Vue.js
fix: corrige auto-healing que parava após 3 tentativas
docs: atualiza README com exemplo de uso do comando scan
refactor: reorganiza estrutura de agentes
test: adiciona testes para comando config
```

**Formato:**
```
<tipo>: <descrição curta>

<descrição detalhada opcional>

<footer opcional: Closes #123>
```

**Tipos:**
- `feat`: Nova funcionalidade
- `fix`: Correção de bug
- `docs`: Documentação
- `refactor`: Refatoração de código
- `test`: Adição/modificação de testes
- `chore`: Tarefas de manutenção

### Enviando PR

1. **Push** para seu fork:
   ```bash
   git push origin feature/minha-feature
   ```
2. **Abra** um Pull Request no GitHub
3. **Descreva:**
   - O que foi mudado
   - Por que foi mudado
   - Como testar
   - Issues relacionadas (se houver)

**Checklist antes de enviar:**
- [ ] Código compila sem erros (`npm run build`)
- [ ] Testes passam (`npm test`)
- [ ] README atualizado (se aplicável)
- [ ] CHANGELOG.md atualizado (se aplicável)
- [ ] Commit messages seguem o padrão

---

## 🧪 Executando Testes

```bash
# Todos os testes
npm test

# Testes em modo watch
npm test -- --watch

# Coverage
npm test -- --coverage
```

---

## 📚 Documentação

Se sua PR adiciona/modifica funcionalidades:

1. **Atualize** o README.md (PT-BR)
2. **Atualize** o README.en.md (EN)
3. **Adicione** exemplos de uso
4. **Documente** novas opções/comandos

---

## 🏗️ Estrutura do Projeto

```
shark-ai/
├── src/               # Código fonte TypeScript
│   ├── bin/           # Entry point do CLI
│   ├── commands/      # Implementação de comandos
│   ├── core/          # Lógica central
│   │   ├── agents/    # Orquestração de agentes
│   │   ├── config/    # Gestão de configuração
│   │   └── error/     # Tratamento de erros
│   └── ui/            # Componentes de interface
├── docs/              # Documentação e assets
├── dist/              # Build output (gerado)
├── tests/             # Testes (se houver)
└── _bmad-output/      # Artifacts de planejamento (não commitar)
```

---

## 🚀 Processo de Release

1. Atualizar versão no `package.json`
2. Atualizar `CHANGELOG.md`
3. Criar tag: `git tag v0.0.x`
4. Push da tag: `git push origin v0.0.x`
5. GitHub Action publica automaticamente no npm

---

## 💬 Dúvidas?

- **Issues:** Para bugs e features
- **Discussions:** Para perguntas e discussões gerais

---

**Obrigado por contribuir! 🦈✨**
