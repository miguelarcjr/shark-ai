# Exemplo de Integração: Shark AI + WhatsApp (via Baileys)

Este diretório contém uma demonstração completa e pronta para uso que conecta o **Shark AI** diretamente ao **WhatsApp** através da biblioteca `@whiskeysockets/baileys`.

---

## 🏗️ Como Funciona a Arquitetura

O bot atua como um consumidor leve e independente do Shark AI:

```text
[WhatsApp Usuário]
       │
       ▼ (Sockets / QR Code)
[Baileys (examples/whatsapp-bot)]
       │
       ▼ (Implementa WhatsAppTransport)
[WhatsAppAdapter (shark-ai)]
   ├── Debouncing de 800ms (junta mensagens picadas)
   ├── Fatiador de 3.500 caracteres
   └── Anti-Spam / Rate-limiting
       │
       ▼ (Inbound / Outbound Events)
[AgentEngine Core (shark-ai)]
   ├── projectRoot configurável (pasta do projeto ativo)
   ├── Trava de Sessão no SQLite (SessionTurnLease)
   ├── Aprovações Duráveis com TTL (PendingApprovals)
   └── Cancelamento Ativo via AbortController
```

---

## 🚀 Como Rodar o Exemplo

### 1. Entrar na pasta do exemplo
```bash
cd examples/whatsapp-bot
```

### 2. Instalar as dependências do Baileys
```bash
npm install
```

### 3. (Opcional) Definir o projeto padrão
Você pode definir em qual projeto o bot começará trabalhando através da variável `SHARK_PROJECT_ROOT`:
```bash
# Windows PowerShell
$env:SHARK_PROJECT_ROOT = "D:\projetos\meu-sistema"

# Linux / Mac
export SHARK_PROJECT_ROOT="/home/user/projetos/meu-sistema"
```
Se não for definida, ele começará na pasta atual.

### 4. Iniciar o bot
```bash
npm start
```

### 5. Escanear o QR Code
- Um QR Code será renderizado diretamente no seu terminal.
- Abra o WhatsApp no celular -> **Aparelhos Conectados** -> **Conectar um aparelho**.
- Escaneie o QR Code.

---

## 💬 Comandos e Recursos Disponíveis no WhatsApp

* **Gerenciar Projetos / Workspaces:**
  * `/pwd` ou `/workspace`: Exibe a pasta do projeto onde o agente está trabalhando atualmente.
  * `/use <caminho>`: Altera a pasta de trabalho do agente dinamicamente (ex: `/use D:\projetos\meu-app`).
* **Interrupção:**
  * `/stop` ou `/abort`: Cancela a tarefa do agente em execução imediatamente.
* **Conversas Diretas (DMs):**
  * Envie qualquer instrução de desenvolvimento (ex: *"Crie um endpoint de healthcheck com Express"*).
* **Debouncing Automático:**
  * Mensagens picadas consecutivas são agrupadas com 800ms de silêncio antes de acionar a IA.
* **Filtro em Grupos:**
  * Em grupos de WhatsApp, o bot só responderá caso seja mencionado explicitamente (`@Shark`) ou se a mensagem começar com `/shark`.
