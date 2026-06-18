# Guia de Configuração: StackSpot AI + Shark AI

Este guia orienta passo a passo como configurar o **StackSpot AI** para atuar como o provedor de IA (LLM) do **Shark AI**.

---

## 💡 Conceito: Provedor de Agente Único (Joker Agent)

O Shark AI utiliza um design otimizado de **Agente Único** (Joker Agent) na StackSpot. Você não precisa criar e gerenciar múltiplos agentes na StackSpot (um para BA, um para Spec, etc.). 
Em vez disso, você configura **um único agente** no portal da StackSpot AI e o Shark AI injeta dinamicamente as diretrizes do prompt de sistema correspondentes a cada fase do desenvolvimento no payload da primeira mensagem da conversa.

---

## 🛠️ Passo a Passo de Configuração

### Passo 1: Obter Credenciais de API na StackSpot

Para que a CLI do Shark AI se autentique na plataforma StackSpot, você precisa de um par de chaves OAuth e do identificador da conta (Realm).

1. Acesse o [Portal da StackSpot](https://portal.stackspot.com) e faça login.
2. No menu lateral ou no canto superior direito, acesse as configurações da sua organização e clique em **API Clients** ou **OAuth Clients**.
3. Crie um novo cliente de API:
   * **Nome:** `shark-cli` (ou o nome que preferir)
   * **Descrição:** Acesso da CLI Shark AI aos agentes
4. Após criar, a StackSpot exibirá as seguintes chaves (copie-as e salve de forma segura):
   * **Client ID**
   * **Client Key** (Client Secret)
5. Identifique o seu **Realm (Slug)**. Ele é o identificador organizacional contido na URL do portal StackSpot, por exemplo:
   * Se sua URL for `https://portal.stackspot.com/minha-empresa/...`, o seu Realm é `minha-empresa`.
   * Se você usa a conta gratuita de testes, o Realm costuma ser `stackspot-freemium`.

---

### Passo 2: Fazer Login na CLI do Shark AI

Com as credenciais em mãos, abra o terminal e execute:

```bash
shark login
```

O assistente solicitará interativamente as informações:
* **Account Realm (Slug):** Insira o Realm identificado (ex: `stackspot-freemium`).
* **Client ID:** Insira o Client ID copiado do portal.
* **Client Key:** Insira a Client Key (Secret) copiado do portal.

Após o login bem-sucedido, o token de autenticação será armazenado de forma segura na sua máquina.

---

### Passo 3: Criar e Configurar o Agente na StackSpot AI

Agora você deve configurar o agente inteligente que interpretará as chamadas de desenvolvimento.

1. No portal StackSpot, acesse a área do **StackSpot AI** e entre em um **Workspace** ativo da sua organização.
2. Acesse a aba de **Agentes** (Agents) e clique em **Criar Agente**.
3. Defina as configurações básicas:
   * **Nome:** `Shark Dev Agent` (ou similar)
   * **Modelo (LLM):** Escolha um modelo de alta capacidade (como GPT-4o, Claude 3.5 Sonnet ou similar disponível no seu tenant).
4. **Instruções de Resposta Estruturada (Opcional, mas Recomendado):**
   Para garantir que o Agente responda estritamente usando o formato JSON esperado pelo Shark AI, você pode exportar o JSON Schema do agente rodando no seu terminal:
   ```bash
   shark export-schema
   ```
   * Copie a saída do comando e insira-a na descrição das instruções do agente no portal da Stackspot AI, solicitando que as respostas sempre sigam esse padrão estruturado JSON.
5. Publique o Agente.
6. Após a publicação, copie o **Agent ID** (um código identificador de 26 caracteres alfanuméricos, por exemplo: `01KEQCGJ65YENRA4QBXVN1YFFX`).

---

### Passo 4: Configurar o Agent ID na CLI do Shark AI

Para vincular o agente criado à CLI do Shark AI:

1. Execute o comando interativo de configuração:
   ```bash
   shark config
   ```
2. No menu principal, selecione a opção **`agents`** (ou `Configure Agent IDs`).
3. Selecione o agente principal de desenvolvimento (**`dev`**).
4. Cole o **Agent ID** copiado no Passo 3 e confirme.
5. Defina a versão do agente (geralmente `1`).

O assistente salvará a configuração global no arquivo `~/.sharkrc` com a estrutura abaixo:

```json
{
  "provider": "stackspot",
  "stackspot": {
    "agentId": "SEU_AGENT_ID_AQUI"
  }
}
```

---

## 🚀 Próximo Passo

Com tudo pronto, você pode iniciar o ciclo de desenvolvimento orquestrado executando:

```bash
shark init
```
e em seguida:
```bash
shark dev
```
