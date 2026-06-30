# Spec - Comando de Visualização de Grafo de Memória do Membox

Este documento especifica o design e a implementação do comando de visualização gráfica do banco de dados de memórias episódicas e de traces temáticas do `shark-ai`.

---

## 1. Visão Geral

Atualmente, o Membox processa e consolida memórias (caixas e traces) silenciosamente no disco local. Este design propõe a criação de um servidor local minimalista exposto via comando CLI (`shark graph`) que renderiza uma página web interativa de alto impacto estético e intuitividade. O objetivo é permitir ao usuário e desenvolvedor assistirem à formação de memórias causais e semânticas em tempo real.

---

## 2. Requisitos e Cenários de Uso

### Casos de Uso
1. **Visualização de Boxes e Traces (Abordagem 3)**: Exibir tópicos de conversação consolidados como nós e as conexões geradas pelas traces causais compartilhadas como arestas.
2. **Visualização Temporal de Eventos (Abordagem 2)**: Exibir uma linha do tempo conectando ações individuais com setas de causalidade cronológica.
3. **Inspeção de Contexto**: Clicar em qualquer nó para abrir um painel lateral e inspecionar o diálogo completo do chat, metadados e tags.
4. **Atualização ao Vivo (Live Updates)**: Monitorar o grafo mudando na tela enquanto uma conversa ativa acontece em outro terminal.

---

## 3. Especificação Técnica

### A. Comando CLI e Servidor Local

* **Arquivo**: `src/commands/graph.ts`
* **Porta**: Padrão `4200` (com auto-incremento se ocupada).
* **Endpoints HTTP**:
  - `GET /` - Serve a interface HTML estática.
  - `GET /api/graph?mode=boxes|timeline` - Retorna os dados do grafo em formato JSON.

#### Estrutura de Retorno do JSON (/api/graph)
```json
{
  "nodes": [
    {
      "id": "box_1",
      "label": "Tópico: MVP do Trello",
      "type": "box",
      "size": 25,
      "details": {
        "topic": "MVP do Trello",
        "keywords": ["Trello", "SQLite", "Express"],
        "history": [
          { "role": "user", "content": "..." },
          { "role": "assistant", "content": "..." }
        ]
      }
    }
  ],
  "edges": [
    {
      "from": "box_1",
      "to": "box_2",
      "label": "Trace 3",
      "arrows": "to"
    }
  ]
}
```

---

## 4. Frontend e Estética Visual

A página única carregada no navegador usará:
1. **Tailwind CSS (via CDN)**: Layout flexível em Grid/Flex com Dark Mode nativo.
2. **Vis.js Network (via CDN)**: Canvas HTML5 com aceleração e modelo de física de repulsão.
3. **Painel de Detalhes Lateral**: Cartão translúcido (Glassmorphism) com animações de transição suave.
4. **Filtros e Busca**: Caixa de busca que destaca e foca nos nós digitados.

---

## 5. Plano de Verificação

### Testes Automatizados
* Validar a API HTTP local `/api/graph` criando requisições mockadas em `src/commands/graph.test.ts`.
* Validar que arquivos corrompidos ou em branco no diretório `.shark/membox` retornam estruturas vazias íntegras `{ nodes: [], edges: [] }` ao invés de lançar exceções não capturadas.

### Verificação Manual
* Executar `shark graph` com dados pré-existentes e verificar se a porta `4200` abre e se o navegador é invocado automaticamente.
* Simular concorrência subindo dois servidores simultâneos e checar se o redirecionamento de porta (ex: porta `4201`) funciona de forma resiliente.
