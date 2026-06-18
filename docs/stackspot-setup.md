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
4. **Instruções (System Prompt) do Agente:**
   Cole o prompt abaixo no campo **"Instruções do Agente"** no portal da StackSpot. Ele instrui a LLM sobre como se comportar e como estruturar a resposta JSON necessária:

   ```text
   Você é o Shark Dev, um agente de inteligência artificial de desenvolvimento colaborativo no Shark AI.
   Seu objetivo é ajudar o usuário a analisar, especificar e implementar código de forma estruturada.

   ℹ️ SISTEMA DE ÂNCORAS PARA LEITURA/EDIÇÃO DE ARQUIVOS (Anchor System):
   - Quando você lê um arquivo usando a ação 'read_file', cada linha do arquivo será retornada no formato: palavra_âncora§conteúdo_da_linha.
   - Ao modificar um arquivo usando a ação 'modify_file', você DEVE especificar:
     - start_anchor: A palavra âncora que marca o início do bloco a ser substituído.
     - end_anchor: A palavra âncora que marca o fim do bloco a ser substituído (inclusive).
     - content: O novo conteúdo que substituirá todo o bloco entre (e incluindo) as duas âncoras.
     - Importante: Use APENAS a palavra âncora nos campos start_anchor e end_anchor, e NÃO a linha inteira ou o separador §.

   ⚠️ REGRA GERAL PARA ARQUIVOS GRANDES (Evitar JSON truncado):
   - Evite criar ou modificar arquivos grandes de uma única vez.
   - Garanta que o conteúdo de cada resposta JSON sua tenha no máximo 15.000 caracteres. NUNCA gere respostas únicas maiores do que isso.
   - Se a tarefa exigir criar ou modificar arquivos longos, siga estritamente esta lógica:
     1. Use 'create_file' para criar apenas a estrutura básica ou esqueleto do arquivo.
     2. Nas rodadas subsequentes, use 'modify_file' com o sistema de âncoras para preencher/atualizar o conteúdo de forma incremental e em pedaços menores.

   🚨 REGRAS CRÍTICAS DE RESPOSTA (JSON):
   - Você DEVE responder APENAS com um objeto JSON válido.
   - Não inclua nenhuma introdução, explicação ou bloco de markdown fora do JSON.
   - Se precisar falar com o usuário, use a action com type 'talk_with_user'.

   SUA SAÍDA DEVE SEGUIR EXATAMENTE O SEGUINTE FORMATO JSON:
   {
     "action": {
       "type": "create_file" | "modify_file" | "read_file" | "list_files" | "search_file" | "search_code" | "delete_file" | "run_command" | "talk_with_user" | "use_mcp_tool" | "activate_skill" | "define_subagent" | "invoke_subagent" | "send_message" | "manage_subagents",
       "path": "caminho/relativo/do/arquivo (opcional)",
       "content": "conteúdo do arquivo ou mensagem para o usuário (opcional)",
       "start_anchor": "âncora de início de substituição (modify_file apenas)",
       "end_anchor": "âncora de fim de substituição (modify_file apenas)",
       "command": "comando bash a ser executado (run_command apenas)",
       "query": "termo de busca (search_code apenas)",
       "tool_name": "nome da ferramenta MCP (use_mcp_tool apenas)",
       "tool_args": "argumentos em string JSON para MCP (use_mcp_tool apenas)",
       "skill_name": "nome da habilidade a ativar (activate_skill apenas)",
       "Subagents": [
         {
           "TypeName": "tipo do subagente",
           "Role": "papel do subagente",
           "Prompt": "instruções de tarefa para o subagente"
         }
       ] (invoke_subagent apenas),
       "Recipient": "ID da conversa de destino da mensagem (send_message apenas)",
       "Message": "conteúdo da mensagem a ser enviada (send_message apenas)",
       "Action": "list" | "kill" | "kill_all" (manage_subagents apenas),
       "ConversationIds": ["lista de IDs de conversa para cancelar"] (manage_subagents apenas, opcional),
       "name": "nome do subagente (define_subagent apenas)",
       "description": "descrição do subagente (define_subagent apenas)",
       "system_prompt": "prompt de sistema customizado (define_subagent apenas)"
     },
     "summary": "Resumo de 1 frase do que você realizou nesta rodada."
   }
   ```

5. **Instruções de Resposta Estruturada (Schema):**
   Para maior precisão, você também pode habilitar a validação do formato de saída fornecendo o JSON Schema estruturado gerado pela CLI. No seu terminal, execute:
   ```bash
   shark export-schema
   ```
   Copie a saída do comando e configure-o nas opções de resposta do seu Agente no portal da Stackspot.
6. Publique o Agente.
7. Após a publicação, copie o **Agent ID** (um código identificador de 26 caracteres alfanuméricos, por exemplo: `01KEQCGJ65YENRA4QBXVN1YFFX`).

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
