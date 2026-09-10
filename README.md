# 🦈 Shark AI

<div align="center">

```
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣠⣄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣠⣾⣿⣿⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⢀⣀⣀⣀⣀⣀⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣰⣿⣿⣿⣿⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⢠⣾⣿⣏⠉⠉⠉⠉⠉⠉⢡⣶⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠘⠻⢿⣿⣿⣿⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣤⡄⠀
⠈⣿⣿⣿⣿⣦⣽⣦⡀⠀⠀⠛⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠉⠛⢧⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣠⣿⣿⠀⠀
⠀⠘⢿⣿⣿⣿⣿⣿⣿⣦⣄⣀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣾⣿⣿⠇⠀⠀
⠀⠀⠈⠻⣿⣿⣿⣿⡟⢿⠻⠛⠙⠉⠋⠛⠳⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣠⣿⣿⣿⡟⠀⠀⠀
⠀⠀⠀⠀⠈⠙⢿⡇⣠⣤⣶⣶⣾⡉⠉⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⣰⣰⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠠⠾⢇⠀⠀⠀⠀⠀⣴⣿⣿⣿⣿⠃⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠱⣿⣿⣿⣿⣿⣿⣦⡀⠀⠀⠀⠀⠀⠀⠀⠀⣰⣿⣿⡇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠐⠤⢤⣀⣀⣀⣀⣀⣀⣠⣤⣤⣤⣬⣭⣿⣿⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠈⠛⢿⣿⣿⣿⣿⣿⣶⣤⣄⣀⣀⣠⣴⣾⣿⣿⣿⣷⣤⣀⡀⠀⠀⠀⠀⠀⠀⣀⣀⣤⣾⣿⣿⣿⣿⡿⠿⠛⠛⠻⣿⣿⣿⣿⣇⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠙⠻⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣶⣶⣤⣤⣘⡛⠿⢿⡿⠟⠛⠉⠁⠀⠀⠀⠀⠀⠈⠻⣿⣿⣿⣦⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣴⣾⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⠿⢿⣿⣿⣿⣿⣿⣶⣦⣤⣀⡀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠻⣿⣿⡄⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢠⣾⣿⣿⣿⠿⠛⠉⠁⠀⠈⠉⠙⠛⠛⠻⠿⠿⠿⠿⠟⠛⠃⠀⠀⠀⠉⠉⠉⠛⠛⠛⠿⠿⠿⣶⣦⣄⡀⠀⠀⠀⠀⠀⠈⠙⠛⠂
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠠⠿⠛⠋⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠉⠉⠁⠀⠀⠀⠀⠀⠀⠀⠀

   ____  _   _   _    ____  _  __      _    ___ 
  / ___|| | | | / \  |  _ \| |/ /     / \  |_ _|
  \___ \| |_| |/ _ \ | |_) | ' /     / _ \  | | 
   ___) |  _  / ___ \|  _ <| . \    / ___ \ | | 
  |____/|_| |_/_/   \_\_| \_\_|\_\  /_/   \_\___|
                                                  
  AI-Native Autonomous & Collaborative Development Tool

```

**Ferramenta de Desenvolvimento Autônomo e Colaborativo com IA**

*Assistente de engenharia de software orientado a agentes, memória determinística e orquestração de código no terminal*

[![npm version](https://img.shields.io/npm/v/shark-ai.svg)](https://www.npmjs.com/package/shark-ai)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen)](https://nodejs.org/)

[English](./README.en.md) | **Português**

</div>

---

## 🎯 O Que é o Shark AI?

O **Shark AI** é um assistente de engenharia de software via CLI (*Command Line Interface*) desenhado para atuar diretamente no seu repositório como um desenvolvedor parceiro ou autônomo.

Diferente de assistentes genéricos, o Shark AI opera com uma **TUI rica**, ferramentas locais de análise semântica (`ast-grep`, `ripgrep`), capacidade de orquestrar **subagentes paralelos**, persistência de estado e uma **arquitetura de memória determinística em 3 camadas inspirada no Hermes Agent**, preservando Prompt Caching e eliminando dependências estocásticas pesadas.

---

## ✨ Principais Pilares da Arquitetura

### 🧠 1. Arquitetura de Memória Determinística (Padrão Hermes)
Adeus a embeddings lentos e indexadores vetoriais locais pesados. O Shark AI adota uma arquitetura em 3 camadas determinística:
- **`MemoryStore` (Arquivos Planos & Limites Rígidos)**:
  - `MEMORY.md` local (`<workspace>/.shark/MEMORY.md`, máx. 2.200 chars) para convenções e notas do projeto.
  - `USER.md` global (`~/.shark/USER.md`, máx. 1.375 chars) para preferências do desenvolvedor.
  - `SOUL.md` global (`~/.shark/SOUL.md`, máx. 1.000 chars) **estritamente somente-leitura** para proteção contra *prompt injection* e *drift* de persona.
  - **Medidores de Capacidade**: Cabeçalhos estruturados com métricas `[XX% — Y/Z chars]` e protocolo de recuperação estruturado em caso de overflow.
- **`StateDB` (SQLite FTS5 Nativo)**:
  - Banco local indexado usando o motor nativo `node:sqlite` do Node 22 com modo WAL e triggers para busca full-text com latência garantida em **<10ms** via ferramenta `session_search`.
- **`ContextCompressor` (Tail Protection & Resumo Híbrido)**:
  - Monitora o teto de 80% da janela de tokens. Preserva estritamente o Turno 0/1 (*Pinned*) e os últimos 15 turnos da conversa (*Tail Protection*), além de garantir o alinhamento de pares de ferramentas (`tool_call` e `tool_result`).
- **Frozen Snapshot (Prompt Caching)**:
  - As memórias são lidas uma única vez durante o boot da CLI e injetadas no System Prompt de forma congelada, garantindo **75% a 90% de economia de custos e latência** através de Prompt Caching.

### 🤖 2. Developer Agent & Subagentes Especializados
- **Interactive Developer Loop (`shark dev`)**: Ambiente interativo completo com renderização Markdown rica, diff viewer interativo, histórico de comandos e atalhos slash (`/auto`, `/chat`, etc.).
- **Subagentes Concorrentes**: O agente principal pode despachar subagentes em segundo plano para inspecionar testes, refatorar código ou executar pesquisas sem bloquear o fluxo de desenvolvimento.

### 🛠️ 3. Ferramentas Nativas Avançadas
- Execução segura de comandos de terminal com captura de saídas.
- Manipulação e edição cirúrgica de arquivos.
- Busca estrutural no código com `ast-grep` e busca textual de alta performance.
- Ferramentas de governança de memória (`memory` e `session_search`).

### 🌐 4. Suporte Multi-Provedor
- **StackSpot AI**: Integração nativa com OAuth 2.0 PKCE, Workspaces e Knowledge Sources corporativos.
- **OpenAI-Compatible**: Suporte direto para OpenAI, DeepSeek, Anthropic (via proxy), Ollama, vLLM e qualquer provedor compatível com a especificação OpenAI.

### ⚡ 5. Superpowers & Skills Integradas (`shark super`)
- Sincronização e instalação de skills avançadas para desenvolvimento agentic: brainstorming iterativo, depuração sistemática, TDD rigoroso, criação de planos e execução orientada a subagentes.

### 📊 6. Visualizador de Grafo de Conhecimento (`shark graph`)
- Extração de grafos de dependências e entidades do projeto com visualização interativa gerada em HTML e Mermaid.

---

## 🚀 Instalação

### Requisitos
- **Node.js >= 22.0.0** (essencial para o suporte nativo ao `node:sqlite`).

### Instalação Global (Versão Estável)
```bash
npm install -g shark-ai
```

### Instalação da Versão de Próxima Geração (@next)
```bash
npm install -g shark-ai@next
```

Ou execute diretamente via `npx`:
```bash
npx shark-ai@next dev
```

---

## ⚡ Guia Rápido de Uso

### 1. Configurar Provedor

#### Para utilizar com StackSpot AI:
```bash
shark login
```
*O navegador abrirá automaticamente para autenticação OAuth 2.0 PKCE. Os tokens de acesso são mantidos em segurança no sistema operacional.*

#### Para utilizar com OpenAI ou provedores compatíveis:
```bash
shark config
```
*Configure o provider como `openai_compatible`, informe a `apiKey`, `baseUrl` (ex: `https://api.openai.com/v1` ou `http://localhost:11434/v1`) e o `modelName` desejado.*

---

### 2. Inicializar o Workspace
No diretório do seu projeto:
```bash
shark init
```
*Cria a estrutura de configuração local `.shark/` e inicializa os arquivos de memória do projeto.*

---

### 3. Iniciar o Modo de Desenvolvimento
```bash
shark dev
```
Você entrará na TUI interativa do Shark Dev:
- Peça para criar features, refatorar componentes ou corrigir bugs.
- O agente pode ler arquivos, rodar testes, verificar diffs e sugerir alterações passo a passo.
- O agente registra automaticamente decisões técnicas em `MEMORY.md` e indexa a sessão no SQLite.

---

## 📚 Comandos da CLI

| Comando | Descrição |
| :--- | :--- |
| `shark dev` | Inicia o agente desenvolvedor autônomo e interativo no terminal. |
| `shark login` | Realiza autenticação via OAuth 2.0 no StackSpot AI. |
| `shark init` | Inicializa a estrutura `.shark/` e configurações no projeto atual. |
| `shark config` | Abre o assistente interativo para alternar provedores (StackSpot / OpenAI) e chaves. |
| `shark super` | Instala e sincroniza o catálogo de skills do Superpowers no workspace. |
| `shark graph` | Analisa a arquitetura do projeto e gera um grafo visual interativo em HTML/Mermaid. |
| `shark export-schema` | Exporta o schema JSON de workflows e configurações. |
| `shark export-prompt` | Imprime ou exporta os prompts do sistema e do Developer Agent para inspeção. |

---

## 📂 Estrutura de Arquivos da Memória

```
~/.shark/                          # Escopo Global do Desenvolvedor
├── USER.md                        # Preferências do usuário (máx. 1.375 chars)
└── SOUL.md                        # Persona do agente (máx. 1.000 chars, somente-leitura)

<seu-projeto>/.shark/              # Escopo Local do Repositório
├── MEMORY.md                      # Decisões técnicas e atalhos do projeto (máx. 2.200 chars)
└── state.db                       # Banco SQLite nativo com FTS5 (histórico de sessões)
```

---

## 🔒 Governança e Segurança

- ✅ **Proteção contra Prompt Injection**: `SOUL.md` é estritamente somente-leitura e as entradas de memória passam por sanitização contra caracteres invisíveis e injeção de tags XML.
- ✅ **Aprovação do Desenvolvedor**: Comandos potencialmente destrutivos passam por confirmação interativa antes de serem disparados no terminal.
- ✅ **Zero Dependências Nativas Problemáticas**: Utiliza o motor nativo `node:sqlite` do Node 22, eliminando falhas de compilação em C++ (node-gyp / MSBuild).

---

## 📄 Licença

Distribuído sob a licença MIT. Consulte o arquivo [LICENSE](./LICENSE) para obter mais informações.

---

<div align="center">

**Desenvolvido com foco em produtividade real para engenheiros de software**

Se o Shark AI te ajudou, deixe uma ⭐ no repositório!

</div>
