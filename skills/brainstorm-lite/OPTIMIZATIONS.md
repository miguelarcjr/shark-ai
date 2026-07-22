# Otimização de Skills para Modelos de Baixo Parâmetro (2B/3B)

Este documento resume as técnicas aplicadas no design da skill `brainstorm-lite`. Elas devem servir de padrão de engenharia de prompt e arquitetura para qualquer nova skill destinada a modelos menores executados localmente ou com limites rígidos de contexto/processamento.

---

## 1. Revelação Progressiva (Progressive Disclosure)
* **Problema:** Colocar todas as instruções de um fluxo complexo e multifase (ex: 7 etapas) em um único arquivo `SKILL.md` consome muitos tokens e causa desvio de atenção (*logic drift*) em modelos menores.
* **Técnica:** Dividir as instruções em etapas físicas no disco (pasta `/steps/`). O arquivo `SKILL.md` principal atua puramente como um roteador de inicialização. O modelo carrega a instrução correspondente à fase atual em cada turno.
* **Benefício:** Redução de até 80% do tamanho do prompt ativo da skill por turno.

## 2. Bootstrapping Interativo (Interactive Initiation Gate)
* **Problema:** Modelos menores sofrem de contradição de instruções. Se o sistema diz *"Se for uma conversa, use talk_with_user"*, e a skill diz *"Comece lendo arquivos imediatamente"*, o modelo de 2B tende a priorizar a conversa inicial e ignora a leitura dos arquivos da skill.
* **Técnica:** Criar uma etapa de validação conversacional (Turno 1) onde o modelo é orientado a apenas apresentar o fluxo e pedir explicitamente permissão para iniciar. 
* **Benefício:** O *"Sim"* do usuário no Turno 2 atua como um gatilho lógico direto, forçando o modelo a sair do modo de conversa genérica e entrar no fluxo de ferramentas de arquivo (`read_file`).

## 3. Caminhos de Arquivo Literais (Zero Placeholders)
* **Problema:** Instruir o modelo a interpolar variáveis para ler arquivos (ex: *"leia step<numero>_<nome>.md"*) causa falhas, pois modelos de 2B/3B falham ao fazer correspondência de padrões complexos e tentam ler caminhos literais inválidos.
* **Técnica:** Escrever caminhos absolutos e relativos exatos (Path A e Path B) no roteador para cada etapa (ex: `.agents/skills/brainstorm-lite/steps/step1_explore.md`).
* **Benefício:** O modelo pode simplesmente "copiar e colar" o caminho exato para a chamada de ferramentas, eliminando erros de resolução de arquivos (*file not found*).

## 4. Estado Persistente no Workspace (Embedded State Machine)
* **Problema:** Manter o histórico de progresso em memória de conversa é frágil para modelos 2B (eles esquecem em qual etapa do fluxo estão).
* **Técnica:** Manter o status em formato de lista Markdown (`- [x]`, `- [/]`, `- [ ]`) diretamente no topo do arquivo que está sendo editado no workspace (`docs/superpowers/specs/...`). O modelo lê o arquivo de spec, descobre qual passo possui a marcação de progresso `[/]` e usa essa informação para carregar a instrução correta.
* **Benefício:** O arquivo do workspace serve como a "memória ram" e única fonte de verdade sobre o estado do fluxo.
