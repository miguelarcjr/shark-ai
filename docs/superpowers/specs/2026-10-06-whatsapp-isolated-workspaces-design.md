# Design Doc: Workspaces Isolados por Perfil/Grupo no WhatsApp Bot

**Data:** 2026-10-06  
**Status:** Aprovado  
**Escopo:** `examples/whatsapp-bot` e `src/core/workspace`

---

## 1. Visão Geral e Motivação

Atualmente, o bot do WhatsApp (`examples/whatsapp-bot`) utiliza um workspace global compartilhado (`currentWorkspace = process.env.SHARK_PROJECT_ROOT || process.cwd()`). Quando um usuário executa `/use <caminho>`, o diretório raiz do `AgentEngine` é alterado globalmente para todas as conversas simultâneas, não havendo isolamento entre diferentes perfis (DMs) ou grupos do WhatsApp. Além disso, o Shark Dev necessita que as skills (`shark super --local` -> `.agents/skills`) e a infraestrutura de projeto (`shark init` -> `.shark/workflow.json`) estejam presentes para operar.

Este projeto introduz a criação e gestão automática de **workspaces dedicados e isolados por chat** (usuário ou grupo), inicializados sob demanda com feedback ao usuário no WhatsApp.

---

## 2. Requisitos e Diretrizes

### 2.1 Requisitos Funcionais
1. **Raiz Configurável:** A pasta base para armazenamento dos workspaces individuais deve ser configurada via variável de ambiente `SHARK_WORKSPACES_ROOT` (padrão: `<process.cwd()>/workspaces`).
2. **Nomenclatura Padronizada:**
   - Para DMs: `workspaces/user_<telefone>` (onde `<telefone>` é o identificador numérico sanitizado extraído de `<id>@s.whatsapp.net`).
   - Para Grupos: `workspaces/group_<id>` (onde `<id>` é o identificador sanitizado extraído de `<id>@g.us`).
3. **Inicialização Automática sob Demanda:**
   - Na primeira interação recebida de um chat cujo workspace ainda não exista:
     - O bot envia uma mensagem ao chat: `⏳ Criando e preparando seu workspace dedicado...`
     - Cria a pasta e inicializa a estrutura completa necessária:
       - `.agents/skills` (cópia das skills internas do Shark AI).
       - `.shark/workflow.json` (workflow básico inicializado).
       - `_sharkrc/project-context.md` (arquivo inicial de contexto do projeto).
       - `.gitignore` (excluindo `.shark/`, `_sharkrc/`, logs).
       - `README.md` (resumo descritivo do workspace individual).
     - Notifica a conclusão no WhatsApp: `✅ Workspace configurado com sucesso! Iniciando atendimento...`
4. **Isolamento de Sessão:**
   - Cada sessão (`whatsapp:dm:${chatId}`) é associada ao seu workspace via `engine.setSessionWorkspace(sessionId, workspacePath)`.
   - Comandos `/pwd` e `/workspace` exibem apenas o workspace daquele chat específico.
   - O comando `/use <caminho>` altera dinamicamente apenas o workspace daquele chat específico via `engine.setSessionWorkspace`.

### 2.2 Requisitos Não-Funcionais e Segurança
1. **Sanitização de Caminhos:** Remoção de caracteres proibidos em caminhos de arquivos nos sistemas operacionais Windows e Linux (`:`, `@`, `/`, `\`, `*`, `?`, etc.).
2. **Controle de Concorrência (Mutex/In-flight Promise):** Se múltiplas mensagens chegarem em rajada antes da finalização do setup inicial, apenas um processo de provisionamento deve ser executado, com as mensagens subsequentes aguardando a mesma Promise.
3. **Resiliência a Erros:** Erros durante a criação de pastas ou cópia de arquivos não derrubam o processo do bot e geram uma mensagem de erro compreensível no chat do WhatsApp.

---

## 3. Arquitetura e Estrutura de Componentes

### 3.1 Novo Componente: `SessionWorkspaceManager`
Localização: `src/core/workspace/session-workspace-manager.ts` (exportado via `src/core/index.ts`).

#### Responsabilidades:
- Resolver caminhos canônicos e sanitizados a partir de `chatId`.
- Verificar existência e integridade do workspace do chat.
- Executar a inicialização programática do workspace (skills + workflow + contexto).
- Evitar inicializações concorrentes duplicadas por meio de cache de promessas ativas (`Map<string, Promise<string>>`).

#### Interface do Serviço:
```typescript
export interface SessionWorkspaceManagerOptions {
    baseDir?: string;
    skillsSourceDir?: string;
}

export interface WorkspaceResolution {
    dirName: string;
    fullPath: string;
    exists: boolean;
    isGroup: boolean;
}

export class SessionWorkspaceManager {
    constructor(options?: SessionWorkspaceManagerOptions);

    resolve(chatId: string): WorkspaceResolution;
    
    ensureWorkspace(
        chatId: string,
        onProgress?: (message: string) => Promise<void>
    ): Promise<string>;
}
```

### 3.2 Integração no `examples/whatsapp-bot/src/index.ts`
1. Instanciação de `SessionWorkspaceManager` apontando para `process.env.SHARK_WORKSPACES_ROOT || path.resolve(process.cwd(), 'workspaces')`.
2. No evento `messages.upsert`:
   - Ao receber a mensagem, chama `ensureWorkspace(chatId, async (msg) => transport.sendText(chatId, msg))`.
   - Vincula a sessão ao engine: `engine.setSessionWorkspace(sessionId, workspacePath)`.
   - O comando `/pwd` / `/workspace` responde com `engine.getSessionWorkspace(sessionId)`.
   - O comando `/use <caminho>` valida a existência e executa `engine.setSessionWorkspace(sessionId, resolvedPath)`.

---

## 4. Estrutura de Arquivos Criada por Workspace

```text
workspaces/
├── user_5511999999999/
│   ├── .agents/
│   │   └── skills/                  <-- Skills instaladas para uso do Shark Dev
│   ├── .shark/
│   │   └── workflow.json            <-- Estado do projeto inicializado
│   ├── _sharkrc/
│   │   └── project-context.md       <-- Contexto do projeto para os subagentes
│   ├── .gitignore                   <-- Ignora .shark/, _sharkrc/, logs
│   └── README.md                    <-- Descrição do workspace individual
└── group_12036302837482910/
    ├── ... (mesma estrutura isolada)
```

---

## 5. Estratégia de Testes

1. **Testes Unitários (`session-workspace-manager.test.ts`):**
   - Resolução de nomes: validar conversão de `5511999999999@s.whatsapp.net` para `user_5511999999999` e `12036302837482910@g.us` para `group_12036302837482910`.
   - Inicialização em pasta temporária: verificar criação das pastas e arquivos essenciais (`.agents/skills`, `.shark/workflow.json`, etc.).
   - Idempotência: garantir que chamar `ensureWorkspace` duas vezes não recria nem sobrescreve arquivos desnecessariamente.
   - Concorrência: garantir que duas chamadas simultâneas compartilham a mesma Promise de inicialização.
2. **Testes de Integração:**
   - Garantir que múltiplos `chatId`s geram e utilizam workspaces completamente independentes no `AgentEngine`.
