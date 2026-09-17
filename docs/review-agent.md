**Sim, o Fork Review Agent roda em um loop de execução de várias ações (*Agent Loop*)** e **NÃO** é uma única requisição estática (*one-shot*) que aguarda apenas uma resposta [cite: 438, 1158].

O funcionamento detalhado do ciclo de ações do Review Agent e o modo como ele sinaliza o encerramento ocorrem da seguinte forma:

---

### 1. Como funciona o Loop de Ações do Review Agent?

* **Execução Autônoma em Segundo Plano**: Quando o *Fork Review Agent* é acionado, o Hermes spowna uma instância em segundo plano do próprio `AIAgent` [cite: 438].
* **Conjunto Restrito de Ferramentas**: Ele é inicializado com acesso a um grupo focado de ferramentas (`memory`, `skill_manage`, `read_file`, `search_files`) [cite: 1154].
* **Múltiplos Passos em Cadeia**: Dentro de um único ciclo de revisão, o Review Agent pode realizar **dezenas de iterações consecutivas** [cite: 1158]. Por exemplo:
  1. Ele pode primeiro executar a ferramenta `read_file` para inspecionar um arquivo `SKILL.md` existente no disco [cite: 1154];
  2. Em seguida, analisa o conteúdo e chama `skill_manage` com a ação `patch` para atualizar o procedimento [cite: 1153];
  3. Na iteração seguinte, chama a ferramenta `memory` com a ação `add` para registrar uma preferência descoberta [cite: 1152].

---

### 2. Como ele sinaliza que o trabalho terminou?

O encerramento do ciclo do Review Agent ocorre através dos seguintes mecanismos:

* **Sinalização Natural por Ausência de `tool_calls`**:
  * Em cada iteração do loop, o runtime do agente analisa o objeto da resposta do modelo [cite: 253].
  * Enquanto a resposta do LLM contiver novas instruções de execução no campo `tool_calls`, o runtime executa as ferramentas e realimenta o modelo [cite: 253].
  * Quando a LLM avalia que já aplicou todas as alterações e memórias necessárias, ela envia uma resposta contendo **apenas texto** (sem requisições no bloco `tool_calls`) [cite: 253].
  * O runtime detecta a ausência de novas chamadas de ferramenta e reconhece que o Review Agent concluiu o seu trabalho [cite: 253].

* **Teto de Orçamento de Tokens (`_review_input_token_budget`)**:
  * Como salvaguarda para impedir que o processo de segundo plano rode indefinidamente ou consuma recursos excessivos, o runtime monitora o teto de tokens do *fork* (`_review_input_token_budget`) [cite: 1158].
  * Se o acumulado de chamadas atingir esse limite, o loop de ferramentas é interrompido obrigatoriamente [cite: 1158].

* **Sincronização e Notificação de Fechamento**:
  * Ao finalizar o loop, as edições são persistidas no disco (ou enviadas para a fila de retenção caso `memory.write_approval` ou `skills.write_approval` estejam ativados) [cite: 508].
  * O runtime grava o log de telemetria da revisão (`_log_review_completion`) [cite: 1095] e, se as notificações estiverem ligadas (`display.memory_notifications`), emite um aviso no chat da sessão ativa (como `💾 Memory updated` ou o diff da skill alterada) [cite: 510, 1154].

---

💡 **Gostaria de ver o trecho de código em Python (`agent/background_review.py`) que gerencia a verificação das `tool_calls` e o encerramento da thread do Review Agent?**