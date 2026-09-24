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

### 3. Iniciar o bot
```bash
npm start
```

### 4. Escanear o QR Code
- Um QR Code será renderizado diretamente no seu terminal.
- Abra o WhatsApp no celular -> **Aparelhos Conectados** -> **Conectar um aparelho**.
- Escaneie o QR Code.

---

## 💬 Recursos Suportados

1. **Conversas Diretas (DMs):** Envie qualquer instrução de desenvolvimento (ex: *"Crie um componente de botão em React"*).
2. **Debouncing Automático:** Se enviar várias mensagens picadas seguidas (*"olha"*, *"gera uma função"*, *"que soma 2 números"*), o Shark aguarda 800ms de silêncio e processa tudo junto.
3. **Interrupção:** Digite `/stop` ou `/abort` a qualquer momento para cancelar o turno em execução imediatamente.
4. **Filtro de Grupos:** Em grupos, o bot só responderá caso seja mencionado explicitamente ou se a mensagem começar com `/shark`.
5. **Aprovações Interativas:** Se o agente executar uma ação sensível, ele envia a solicitação numerada (*"Responda 1 para Aprovar ou 2 para Rejeitar"*).
