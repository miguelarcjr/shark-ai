Title:

Content selection saved. Describe the issue below:

Description:

[License: CC BY 4.0](https://info.arxiv.org/help/license/index.html#licenses-available)

arXiv:2601.03785v3 \[cs.CL\] 24 Jun 2026

# Membox: Weaving Topic Continuity into Long‑Range Memory for LLM Agents
graph TD
    q[Nova Query/Instrução] --> Embed[Gerar Embedding de q]
    Embed --> SearchBoxes[Buscar Top-K Caixas Seladas]
    SearchBoxes --> BoxContent[Recupera Diálogo Completo das Caixas]
    SearchBoxes --> ExtractEvents[Pega Eventos das Caixas Recuperadas]
    ExtractEvents --> EventSearch[Busca Top-K Eventos Similares a q]
    EventSearch --> TraceSearch[Recupera as Traces Lineares desses Eventos]
    TraceSearch --> TraceEvents[Pega a Linha do Tempo de Eventos da Trace]
    
    BoxContent & TraceEvents & Latest[Últimos 2 Turnos do Chat] & System[Prompt do Sistema] --> Builder[Montador do Prompt Final]
    Builder --> LLM[Enviar para o LLM]

Dehao Tao

Tsinghua University

tdh23@mails.tsinghua.edu.cn
&Guoliang Ma

Xinjiang University
&Yongfeng Huang

Tsinghua University

&Minghu Jiang

Tsinghua University

###### Abstract

Long-term human–agent dialogues are organized by topic continuity: adjacent turns often develop the same goal, plan, problem, or event, while related activities may recur across distant sessions. Yet many LLM agent memory systems first decompose histories into isolated turns or fixed-size chunks, then compensate through enrichment, consolidation, or retrieval mechanisms still tied to semantic proximity or fragment-level records. This weakens temporal and causal organization and biases memory access toward semantic proximity rather than task- or topic-level continuity.
We introduce _Membox_, a hierarchical memory architecture that instantiates topic continuity as an explicit organization layer for agent memory. Its Topic Loom incrementally organizes dialogue streams into boxes whose internal turns follow the same local topic, while its Trace Weaver links extracted events across boxes into macro-topic traces that recover recurring activities, goals, and factual developments across distant sessions.
On LoCoMo, Topic-Loom-only retrieval improves over the best Mem0/A-MEM retrieval-depth setting by 13.00 F1 points (53.95 vs. 40.95), and trace-expanded retrieval further raises F1 to 55.28; with GPT-4o, trace-expanded retrieval reaches 59.71 F1. Additional DialSim results show the same gain from adding cross-box traces in multi-party dialogue. These results show that local topic-continuity organization and macro-topic trace expansion improve long-range memory beyond semantic retrieval over fragmented records.

Membox: Weaving Topic Continuity into Long‑Range Memory for LLM Agents

Dehao TaoTsinghua Universitytdh23@mails.tsinghua.edu.cnGuoliang MaXinjiang UniversityYongfeng HuangTsinghua UniversityMinghu JiangTsinghua University

## 1 Introduction

Human memory and discourse are inherently structured around continuity. Cognitive accounts of episodic memory suggest that temporally adjacent events or interactions are bound into coherent episodes, preserving temporal order and causal relations Miller ( [1956](https://arxiv.org/html/2601.03785v3#bib.bib1 "The magical number seven, plus or minus two: some limits on our capacity for processing information")); Tulving ( [1983](https://arxiv.org/html/2601.03785v3#bib.bib2 "Elements of episodic memory")); Baddeley ( [2000](https://arxiv.org/html/2601.03785v3#bib.bib5 "The episodic buffer: a new component of working memory?")). Discourse theories further characterize such continuity as hierarchical: stable macro‑topics persist across interaction, while local micro‑topics drift as the conversation unfolds Grosz and Sidner ( [1986](https://arxiv.org/html/2601.03785v3#bib.bib6 "Attention, intentions, and the structure of discourse")); Schiffrin ( [1994](https://arxiv.org/html/2601.03785v3#bib.bib17 "Approaches to discourse")).

For LLM agents, this continuity is not merely descriptive but functional: users often expect an agent to answer current questions by following an ongoing activity, goal, or concern across prior interactions, even when the wording changes. A question about whether one should continue running, for example, may depend jointly on earlier discussion of marathon training, recurring knee pain, and medical advice to reduce training intensity. These turns differ in surface semantics—exercise, pain, and medical advice—yet their relevance comes from belonging to the same evolving topic trajectory. Answering such questions therefore requires memory access that can retrieve these topically connected turns together, rather than treating each turn as an independent semantic match to the query.

![Refer to caption](https://arxiv.org/html/2601.03785v3/x1.png)Figure 1: A representative failure of fragmentation-based memory. An ongoing running-related episode is written as separate utterance-level memories, creating contextual gaps; similarity-based retrieval recalls lexically related running and pain memories but can miss low-similarity yet topic-relevant medical advice.

Most existing agent memory systems Zhong et al. ( [2024](https://arxiv.org/html/2601.03785v3#bib.bib16 "MemoryBank: enhancing large language models with long-term memory")); Xu et al. ( [2025](https://arxiv.org/html/2601.03785v3#bib.bib3 "A-mem: agentic memory for llm agents")); Chhikara et al. ( [2025](https://arxiv.org/html/2601.03785v3#bib.bib4 "Mem0: building production-ready ai agents with scalable long-term memory")) do not provide this topic-level access path. Figure [1](https://arxiv.org/html/2601.03785v3#S1.F1 "Figure 1 ‣ 1 Introduction ‣ Membox: Weaving Topic Continuity into Long‑Range Memory for LLM Agents") illustrates the resulting failure in a simple utterance-level case: the running-related trajectory is written as separate memories, so similarity-based retrieval can recover lexically related running and pain memories while missing the low-similarity medical advice that is central to the later decision. This example reflects a broader fragmentation‑compensation paradigm: dialogue continuity is first broken into separately stored fragments, and later mechanisms such as enrichment, consolidation, or retrieval attempt to compensate by adding back related context. However, because this compensation is still driven largely by semantic proximity or fragment-level operations, it can only approximate the original topic trajectory and may miss evidence whose relevance comes from continuity rather than lexical similarity. We therefore argue that long-term agent memory needs a dedicated topic-continuity organization layer between raw dialogue fragments and retrieval-time semantic matching.

This suggests a different memory-writing principle: long-term agent memory should preserve topic-continuous evidence before retrieval begins, rather than relying on retrieval-time compensation after continuity has been fragmented. By organizing dialogue at write time, temporal and causal relations that were present in the original interaction can remain available as part of the same memory structure, even when some turns are weakly similar to the later query.

To this end, Membox introduces topic continuity as an explicit organization layer at memory construction time. Its Topic Loom writes micro-topic-continuous episodes online as dialogue unfolds: each incoming turn is assigned to either continue the current topic-continuous episode or open a new one before future turns are available. This converts topic-boundary detection from an offline discourse-analysis task into an online memory-writing policy, preserving locally continuous discourse before downstream retrieval begins.

Membox further captures macro-topic continuity through the Trace Weaver, which links these episodes through their extracted events. Events act as anchors for recurring activities, goals, plans, and factual developments that may reappear after local topic shifts. The resulting architecture represents topic continuity at two coupled levels: Topic Loom preserves how a topic unfolds within a local episode, while Trace Weaver preserves how broader themes return or progress across episodes. Figure [2](https://arxiv.org/html/2601.03785v3#S2.F2 "Figure 2 ‣ 2.3 Retrieval-Augmented and Structured Context ‣ 2 Related Work ‣ Membox: Weaving Topic Continuity into Long‑Range Memory for LLM Agents") illustrates this hierarchical memory architecture.

Our contributions are threefold:

- •


We identify topic-level continuity as a missing organizational layer in agent memory and reformulate memory construction around topic-continuous dialogue episodes rather than turn- or chunk-level fragments.

- •


We propose _Membox_, a two-level memory architecture whose Topic Loom captures micro-topic continuity within episodes, and whose Trace Weaver captures macro-topic continuity across episodes.

- •


We evaluate _Membox_ on the _LoCoMo_ benchmark, with additional validation on DialSim, showing that hierarchical continuity-preserving memory improves long-context dialogue QA while offering a favorable quality–context tradeoff.


## 2 Related Work

### 2.1 Long-Term Memory for LLM Agents

Long-term memory systems for LLM agents retain reusable evidence beyond the immediate context window. MemoryBank Zhong et al. ( [2024](https://arxiv.org/html/2601.03785v3#bib.bib16 "MemoryBank: enhancing large language models with long-term memory")) and Ret-LLM Modarressi et al. ( [2023](https://arxiv.org/html/2601.03785v3#bib.bib10 "Ret-llm: towards a general read-write memory for large language models")) use embedding-based indexing, while MemGPT Packer et al. ( [2023](https://arxiv.org/html/2601.03785v3#bib.bib7 "MemGPT: towards LLMs as operating systems")) and SCM Wang et al. ( [2023](https://arxiv.org/html/2601.03785v3#bib.bib9 "Enhancing large language model with self-controlled memory framework")) introduce hierarchical or controller-based memory management. Recent systems emphasize adaptive updates: Mem0 Chhikara et al. ( [2025](https://arxiv.org/html/2601.03785v3#bib.bib4 "Mem0: building production-ready ai agents with scalable long-term memory")) incrementally evolves memory items, ReadAgent Lee et al. ( [2024](https://arxiv.org/html/2601.03785v3#bib.bib8 "A human-inspired reading agent with gist memory of very long contexts")) compresses long contexts into gist representations, and A-MEM Xu et al. ( [2025](https://arxiv.org/html/2601.03785v3#bib.bib3 "A-mem: agentic memory for llm agents")) equips agents with decision-driven memory operations. These methods improve capacity and flexibility, but still operate over turns, chunks, summaries, or mutable records and rely on update or retrieval to compensate for fragmentation. Membox instead inserts a topic-continuity organization layer at write time before retrieval, writing conversational experience as locally coherent episodes and globally linked traces.

### 2.2 Discourse Topic Segmentation

Discourse topic segmentation places boundaries between coherent topical spans in text or dialogue. Classical methods detect boundaries through lexical cohesion and local topic shifts Hearst ( [1997](https://arxiv.org/html/2601.03785v3#bib.bib28 "Text tiling: segmenting text into multi-paragraph subtopic passages")); Galley et al. ( [2003](https://arxiv.org/html/2601.03785v3#bib.bib29 "Discourse segmentation of multi-party conversation")), while neural approaches model segmentation as supervised boundary prediction over fully observed sequences Koshorek et al. ( [2018](https://arxiv.org/html/2601.03785v3#bib.bib30 "Text segmentation as a supervised learning task")); Arnold et al. ( [2019](https://arxiv.org/html/2601.03785v3#bib.bib31 "SECTOR: a neural model for coherent topic segmentation and classification")); Lukasik et al. ( [2020](https://arxiv.org/html/2601.03785v3#bib.bib32 "Text segmentation by cross segment attention")); Jiang et al. ( [2023b](https://arxiv.org/html/2601.03785v3#bib.bib33 "SuperDialseg: a large-scale dataset for supervised dialogue segmentation")). These settings typically assume access to the complete document or dialogue and produce a boundary label sequence.

Membox is inspired by this view of topical spans, but the agentic memory setting changes both the timing and the output of segmentation. An agent must decide online, as each turn arrives and before future context is available, whether the current message should continue the active topic-continuous episode or open a new one. The output is also not merely a boundary sequence, but an organized memory object that supports later retrieval and cross-episode trace construction.

### 2.3 Retrieval-Augmented and Structured Context

Retrieval-Augmented Generation grounds LLM outputs in external evidence retrieved at inference time Lewis et al. ( [2020](https://arxiv.org/html/2601.03785v3#bib.bib12 "Retrieval-augmented generation for knowledge-intensive nlp tasks")); Gao et al. ( [2023](https://arxiv.org/html/2601.03785v3#bib.bib13 "Retrieval-augmented generation for large language models: a survey")). Agent-like methods further let models decide when and what to retrieve through reflection, query refinement, or active retrieval policies Asai et al. ( [2024](https://arxiv.org/html/2601.03785v3#bib.bib14 "Self-RAG: learning to retrieve, generate, and critique through self-reflection")); Jiang et al. ( [2023c](https://arxiv.org/html/2601.03785v3#bib.bib15 "Active retrieval augmented generation")). Other work organizes external knowledge with structured resources such as knowledge graphs for retrieval or symbolic traversal Linders and Tomczak ( [2025](https://arxiv.org/html/2601.03785v3#bib.bib18 "Knowledge graph-extended retrieval augmented generation for question answering")); Baek et al. ( [2023](https://arxiv.org/html/2601.03785v3#bib.bib19 "Knowledge-augmented language model prompting for zero-shot knowledge graph question answering")); Sun et al. ( [2024](https://arxiv.org/html/2601.03785v3#bib.bib20 "Think-on-graph: deep and responsible reasoning of large language model on knowledge graph")); Jiang et al. ( [2023a](https://arxiv.org/html/2601.03785v3#bib.bib21 "UniKGQA: unified retrieval and reasoning for solving multi-hop question answering over knowledge graph")); Chen et al. ( [2024](https://arxiv.org/html/2601.03785v3#bib.bib22 "Plan-on-graph: self-correcting adaptive planning of large language model on knowledge graphs")). These approaches improve access to external context, but not how conversational experience should be organized into continuity-preserving memory structures before retrieval.

![Refer to caption](https://arxiv.org/html/2601.03785v3/x2.png)Figure 2: Overview of the Membox architecture — the Topic Loom groups micro-topic-continuous dialogue into Memboxes, while the Trace Weaver links events across Memboxes into macro-topic traces.

## 3 Method

### 3.1 Membox Construction: The Topic Loom

Real-time agent systems continuously receive streams of user–agent messages, requiring an online decision about what should remain within the same organized episode. Storing each message as an isolated item is computationally simple, but it violates topic continuity: temporally adjacent turns that share an unfolding discourse frame may be separated before later retrieval begins.

We define a _topic-continuous dialogue episode_ as the local object produced by the topic-continuity organization layer: a span of consecutive turns that develop the same discourse topic, even when their surface semantics differ. We therefore use the Topic Loom as the construction layer of Membox: an online, LLM‑guided memory‑writing policy inspired by discourse topic segmentation. Its goal is not to infer a global topic taxonomy or cluster all semantically similar utterances, but to decide whether the incoming turn should continue the locally unfolding episode. The output is not merely a boundary decision, but a structured memory object that serves as the substrate for retrieval and later trace construction.

We maintain a small sliding window of two consecutive messages—one user utterance and one agent response—over the most recent messages in the current unsealed box, and use it for topic continuity classification.
Upon arrival of a new message Mk+1M\_{k+1}, the Loom queries an LLM:

|     |     |     |
| --- | --- | --- |
|  | ck+1←LLM​(window,Mk+1,Pcont),c\_{k+1}\\leftarrow\\mathrm{LLM}\\big(\\text{window},\ M\_{k+1},\ P\_{\\mathrm{cont}}\\big), |  |

where PcontP\_{\\mathrm{cont}} is the classification prompt shown in Appendix Table [9](https://arxiv.org/html/2601.03785v3#A1.T9 "Table 9 ‣ A.6 Prompt Templates ‣ Appendix A Appendix ‣ Membox: Weaving Topic Continuity into Long‑Range Memory for LLM Agents"), and
ck+1∈{continuous,partial​shift,discontinuous}c\_{k+1}\\in\\{\\mathrm{continuous},\ \\mathrm{partial\ shift},\ \\mathrm{discontinuous}\\}.
In practice, most segment-worthy transitions are labeled as partial shifts rather than discontinuities. This is expected in continuous multi-turn conversations, where new topics often emerge through residual links to prior context rather than abrupt resets. For memory construction, partial shifts are treated as topic breaks because they indicate a noticeable change in conversational focus, even when the current turn remains locally related to previous turns.

If the label is _continuous_, the message is appended to the current box.
If it is _partial shift_ or _discontinuous_, the current box is sealed, and a new unsealed box is created with Mk+1M\_{k+1} as its first entry.
To avoid degenerate single-message boxes, we require each new box to contain at least one adjacent response when available. This minimal-context rule is applied before subsequent topic-continuity classification resumes, ensuring that brief utterances are still stored with enough local dialogue context for later interpretation.

When a box transitions to the sealed state, the Loom uses the extraction prompt PextractP\_{\\mathrm{extract}} (Appendix Table [10](https://arxiv.org/html/2601.03785v3#A1.T10.fig1 "Table 10 ‣ A.6 Prompt Templates ‣ Appendix A Appendix ‣ Membox: Weaving Topic Continuity into Long‑Range Memory for LLM Agents")) to produce its structured representation
B={M,topic,events,keywords}B=\\{M,\ \\mathrm{topic},\ \\mathrm{events},\ \\mathrm{keywords}\\}.
The event set events​(B)={e1,e2,…}\\mathrm{events}(B)=\\{e\_{1},e\_{2},\\dots\\} is extracted from the messages in BB and captures concrete actions, factual developments, or plans within the box’s topic, such as marathon training, recurring knee pain, or reducing training intensity in the running example. Since our memory design centers on topic continuity, extracting events provides a natural, fine‑grained representation of each topic, while keywords supply supplementary descriptive details.
The extracted event set E​(B)E(B) becomes the input to the Trace Weaver stage (§ [3.2](https://arxiv.org/html/2601.03785v3#S3.SS2 "3.2 Membox Linking: The Trace Weaver ‣ 3 Method ‣ Membox: Weaving Topic Continuity into Long‑Range Memory for LLM Agents")).

### 3.2 Membox Linking: The Trace Weaver

The Trace Weaver is the macro-continuity layer of Membox. Whereas the Topic Loom binds consecutive turns into locally coherent episodes, the Trace Weaver links sealed Memboxes into cross-episode traces when their events indicate the recurrence, progression, or transformation of a broader theme.

This separation reflects two coupled dimensions of topic continuity. The Topic Loom captures micro-level continuity by preserving consecutive turns that belong to the same unfolding topic. The Trace Weaver captures macro-level continuity by organizing temporally separated Memboxes around recurring activities, goals, plans, and factual developments. Together, the two layers convert dialogue history into a hierarchy of local episodes and long-range topic traces.

Formally, after the Topic Loom seals a Membox Bn​e​wB\_{new}, we obtain its set of extracted events

|     |     |     |
| --- | --- | --- |
|  | E(n​e​w)={e1,e2,…,ep}.E^{(new)}=\\{e\_{1},e\_{2},\\dots,e\_{p}\\}. |  |

Let 𝒯={T1,T2,…,Tq}\\mathcal{T}=\\{T\_{1},T\_{2},\\dots,T\_{q}\\} denote the set of existing traces, and E(Ti)E^{(T\_{i})} the events stored in trace TiT\_{i}.

#### Trace Initialization (if 𝒯=∅\\mathcal{T}=\\varnothing).

If there are no existing traces, we pass E(n​e​w)E^{(new)} to an LLM with the initialization prompt PinitP\_{\\mathrm{init}} (Appendix Table [12](https://arxiv.org/html/2601.03785v3#A1.T12 "Table 12 ‣ A.6 Prompt Templates ‣ Appendix A Appendix ‣ Membox: Weaving Topic Continuity into Long‑Range Memory for LLM Agents")), clustering the events into one or more new traces:

|     |     |     |
| --- | --- | --- |
|  | 𝒯←𝒯∪LLM​(E(n​e​w)∥Pinit).\\mathcal{T}\\leftarrow\\mathcal{T}\\cup\\mathrm{LLM}\\big(E^{(new)}\\,\\\|\\,P\_{\\mathrm{init}}\\big). |  |

This establishes initial macro-topic traces for subsequent linking.

#### Event-to-Trace Voting.

For each event ek∈E(n​e​w)e\_{k}\\in E^{(new)}, we first identify the trace containing the most semantically similar stored event:

|     |     |     |
| --- | --- | --- |
|  | T∗​(ek)=arg⁡maxTi∈𝒯⁡\[maxe′∈E(Ti)⁡sim​(ek,e′)\],T^{\*}(e\_{k})=\\arg\\max\_{T\_{i}\\in\\mathcal{T}}\ \\Big\[\\max\_{e^{\\prime}\\in E^{(T\_{i})}}\ \\mathrm{sim}(e\_{k},e^{\\prime})\\Big\], |  |

where sim​(⋅,⋅)\\mathrm{sim}(\\cdot,\\cdot) is cosine similarity in embedding space.
Each event therefore contributes one nearest trace as a vote. Taking the union of these votes yields a compact candidate trace set,

|     |     |     |
| --- | --- | --- |
|  | 𝒞​(Bn​e​w)={T∗​(ek)∣ek∈E(n​e​w)},\\mathcal{C}(B\_{new})=\\{T^{\*}(e\_{k})\\mid e\_{k}\\in E^{(new)}\\}, |  |

which limits LLM verification to traces that are locally supported by at least one event.

#### LLM Batch Verification.

For each candidate trace Ti∈𝒞​(Bn​e​w)T\_{i}\\in\\mathcal{C}(B\_{new}), we pass both (a) the trace’s existing events E(Ti)E^{(T\_{i})} and (b) the full set of events in the current box E(n​e​w)E^{(new)} to the LLM with the verification prompt PverifyP\_{\\mathrm{verify}} (Appendix Table [11](https://arxiv.org/html/2601.03785v3#A1.T11 "Table 11 ‣ A.6 Prompt Templates ‣ Appendix A Appendix ‣ Membox: Weaving Topic Continuity into Long‑Range Memory for LLM Agents")).
The LLM jointly considers topic context and event semantics to decide which events from E(n​e​w)E^{(new)} should be appended to TiT\_{i}. Thus, although each event selects only one trace during candidate generation, verification compares every new event with every trace in the candidate set; an event may be accepted into multiple traces when it fits multiple macro-topic continuities.
This batch decision process allows cross‑event reasoning within the same box, capturing cases where related events reinforce each other’s topical fit.

#### Secondary Trace Initialization.

Events from E(n​e​w)E^{(new)} not accepted into any existing traces form EunlinkedE\_{\\mathrm{unlinked}}.
If Eunlinked≠∅E\_{\\mathrm{unlinked}}\\neq\\varnothing, they are re‑passed to PinitP\_{\\mathrm{init}} to form new traces.

In our design, traces do not form a single linear chain: an event may legitimately belong to multiple traces, reflecting the branching and intersecting nature of real discourse. Within a single Membox, different events can be assigned to distinct traces, since a local episode may contribute to several recurring macro-topics. The same architecture can support different notions of macro-level continuity, such as causal chains, temporal progressions, or role-based interaction networks, by altering the linking objective and similarity criteria.

Table 1: Main LoCoMo results. _Membox-Compact_ retrieves Topic Loom boxes and provides only box content to the QA model, while _Membox-Trace_ augments retrieved boxes with Trace Weaver events. Both modes use content top-k=10k=10; Trace additionally uses event top-k=2k=2. Entries marked with ∗ (Mem0∗ and A-MEM∗) represent our local re-implementations. For these re-implemented baselines, we tune retrieval depth k∈{5,10,20,30}k\\in\\{5,10,20,30\\} and report the optimal performance. The best result for each model, category, and metric is highlighted in bold.

| Model | Method | Category |
| Multi-Hop | Temporal | Open Domain | Single Hop |
|  |  | F1 | BLEU-1 | F1 | BLEU-1 | F1 | BLEU-1 | F1 | BLEU-1 |
| GPT-4o-mini | LoCoMo | 25.02 | 19.75 | 18.41 | 14.77 | 12.04 | 11.16 | 40.36 | 29.05 |
| GPT-4o-mini | ReadAgent | 9.15 | 6.48 | 12.60 | 8.87 | 5.31 | 5.12 | 9.67 | 7.66 |
| GPT-4o-mini | MemoryBank | 5.00 | 4.77 | 9.68 | 6.99 | 5.56 | 5.94 | 6.61 | 5.16 |
| GPT-4o-mini | MemGPT | 26.65 | 17.72 | 25.52 | 19.44 | 9.15 | 7.44 | 41.04 | 34.34 |
| GPT-4o-mini | A-MEM | 27.02 | 20.09 | 45.85 | 36.67 | 12.14 | 12.00 | 44.65 | 37.06 |
| GPT-4o-mini | A-MEM∗ | 27.08 | 20.46 | 29.14 | 24.08 | 16.60 | 13.80 | 40.70 | 32.63 |
| GPT-4o-mini | Mem0 | 38.72 | 27.13 | 48.93 | 40.51 | 28.64 | 21.58 | 47.65 | 38.72 |
| GPT-4o-mini | Mem0∗ | 36.83 | 26.50 | 34.52 | 26.38 | 22.57 | 16.54 | 46.89 | 37.63 |
| GPT-4o-mini | Membox-Compact | 39.88 | 26.39 | 58.03 | 45.17 | 27.96 | 20.15 | 60.09 | 47.45 |
| GPT-4o-mini | Membox-Trace | 41.19 | 27.49 | 59.63 | 46.52 | 30.36 | 22.52 | 61.18 | 48.99 |
| GPT-4o | LoCoMo | 28.00 | 18.47 | 9.09 | 5.78 | 16.47 | 14.80 | 61.56 | 54.19 |
| GPT-4o | ReadAgent | 14.61 | 9.95 | 4.16 | 3.19 | 8.84 | 8.37 | 12.46 | 10.29 |
| GPT-4o | MemoryBank | 6.49 | 4.69 | 2.47 | 2.43 | 6.43 | 5.30 | 8.26 | 7.10 |
| GPT-4o | MemGPT | 30.36 | 22.83 | 17.29 | 13.18 | 12.24 | 11.87 | 60.18 | 53.35 |
| GPT-4o | A-MEM | 32.86 | 23.76 | 39.41 | 31.23 | 17.10 | 15.84 | 48.43 | 42.97 |
| GPT-4o | Mem0∗ | 42.57 | 30.92 | 44.55 | 32.60 | 23.04 | 17.62 | 48.49 | 37.00 |
| GPT-4o | A-MEM∗ | 31.66 | 23.34 | 41.11 | 34.72 | 17.45 | 15.58 | 47.04 | 41.02 |
| GPT-4o | Membox-Compact | 48.35 | 35.10 | 65.06 | 54.81 | 30.61 | 22.58 | 61.69 | 49.36 |
| GPT-4o | Membox-Trace | 50.48 | 38.17 | 66.61 | 54.15 | 38.77 | 28.19 | 62.56 | 48.95 |

### 3.3 Retrieval

Retrieval follows the hierarchical organization of Membox. Given a query qq, we first rank sealed Memboxes by comparing qq with each box representation R​(B)={M,topic,E​(B),keywords}R(B)=\\{M,\\mathrm{topic},E(B),\\mathrm{keywords}\\}:

|     |     |     |
| --- | --- | --- |
|  | ℬq=TopKB∈ℬkb⁡sim​(q,R​(B)),\\mathcal{B}\_{q}=\\operatorname{TopK}\_{B\\in\\mathcal{B}}^{k\_{b}}\ \\mathrm{sim}\\big(q,R(B)\\big), |  |

where ℬq\\mathcal{B}\_{q} denotes the retrieved boxes and provides the local episodic evidence for the query.
This use of similarity differs from retrieval over fragmented memories: similarity is used only to access already organized memory structures. Once a box is selected, the QA model receives the whole topic-continuous episode, including turns that may be weakly similar to the query but are necessary for interpreting the episode.

When trace information is used, retrieval is refined through the event layer of ℬq\\mathcal{B}\_{q}. Let

|     |     |     |
| --- | --- | --- |
|  | ℰq=⋃B∈ℬqE​(B)\\mathcal{E}\_{q}=\\bigcup\_{B\\in\\mathcal{B}\_{q}}E(B) |  |

be the candidate event set induced by the retrieved boxes. We select the most query-relevant events,

|     |     |     |
| --- | --- | --- |
|  | ℰqtop=TopKe∈ℰqke⁡sim​(q,e),\\mathcal{E}^{\\mathrm{top}}\_{q}=\\operatorname{TopK}\_{e\\in\\mathcal{E}\_{q}}^{k\_{e}}\ \\mathrm{sim}(q,e), |  |

and retrieve the traces associated with these events:

|     |     |     |
| --- | --- | --- |
|  | 𝒯q={Ti∈𝒯∣E(Ti)∩ℰqtop≠∅}.\\mathcal{T}\_{q}=\\{T\_{i}\\in\\mathcal{T}\\mid E^{(T\_{i})}\\cap\\mathcal{E}^{\\mathrm{top}}\_{q}\\neq\\varnothing\\}. |  |

Thus, trace retrieval is a structured expansion of the box-level results: selected boxes determine the candidate events, and the most query-relevant events determine the long-range traces used as additional evidence. In Trace mode, the QA context consists of the retrieved box contents plus all events contained in the selected traces; raw dialogue from non-retrieved boxes is not added.
Similarity therefore serves as an entry point into the topic-continuity organization layer, rather than as a substitute for that organization.

Table 2:
Memory base statistics.
Utterances: total number of utterances;
Tok Ratio: (constructed memory tokens) / (original dialogue tokens);
MB#: Membox count;
Utter/MB: utterances per Membox;
Tok/MB: text tokens per Membox.
Note: “token” here refers to text length, not LLM processing tokens.
Tokens are segmented simply by spaces in this analysis.

| Method | Utterances | Tok Ratio | MB# | Utter/MB | Tok/MB |
| --- | --- | --- | --- | --- | --- |
| Mem0 w/ GPT-4o-mini | 5882 | 1.19 | - | - | - |
| Mem0 w/ GPT-4o | 5882 | 1.20 | - | - | - |
| A-MEM w/ GPT-4o-mini | 5882 | 1.72 | - | - | - |
| A-MEM w/ GPT-4o | 5882 | 1.73 | - | - | - |
| Membox w/ GPT-4o-mini | 5882 | 1.24 | 892 | 6.59 | 342.98 |
| Membox w/ GPT-4o | 5882 | 1.19 | 1206 | 4.88 | 252.63 |

## 4 Experiment

### 4.1 Dataset and Evaluation

We use the LoCoMo benchmark Maharana et al. ( [2024](https://arxiv.org/html/2601.03785v3#bib.bib11 "Evaluating very long-term conversational memory of llm agents")) as our primary evaluation platform. LoCoMo presents a significant long-context challenge, featuring dialogues that average 35 sessions and approximately 9,000 tokens. Such scale requires robust long-range retrieval and stable reasoning across extended sequences.
Following the benchmark protocol, we evaluate four dimensions:
Single-hop Retrieval: extracting specific facts from one session.
Multi-hop Reasoning: synthesizing information across multiple sessions.
Temporal Reasoning: understanding event sequences and durations within the dialogue flow.
Open-domain QA: integrating dialogue history with external commonsense knowledge. The original dataset includes adversarial unanswerable questions, but these specify answers that should not be produced and lack gold answers, so EM/F1 cannot be computed under the standard generation protocol. Treating “unanswerable” as an answer would require a separate abstention protocol and break comparability; we therefore exclude this category from the main benchmark.

We compare Membox with six competitive baselines: LoCoMoMaharana et al. ( [2024](https://arxiv.org/html/2601.03785v3#bib.bib11 "Evaluating very long-term conversational memory of llm agents")), ReadAgentLee et al. ( [2024](https://arxiv.org/html/2601.03785v3#bib.bib8 "A human-inspired reading agent with gist memory of very long contexts")), MemoryBankZhong et al. ( [2024](https://arxiv.org/html/2601.03785v3#bib.bib16 "MemoryBank: enhancing large language models with long-term memory")), MemGPTPacker et al. ( [2023](https://arxiv.org/html/2601.03785v3#bib.bib7 "MemGPT: towards LLMs as operating systems")), A-MEMXu et al. ( [2025](https://arxiv.org/html/2601.03785v3#bib.bib3 "A-mem: agentic memory for llm agents")), and Mem0Chhikara et al. ( [2025](https://arxiv.org/html/2601.03785v3#bib.bib4 "Mem0: building production-ready ai agents with scalable long-term memory")). Appendix [A.2](https://arxiv.org/html/2601.03785v3#A1.SS2 "A.2 Additional DialSim Evaluation ‣ Appendix A Appendix ‣ Membox: Weaving Topic Continuity into Long‑Range Memory for LLM Agents") further evaluates cross-dataset generalization on DialSim Kim et al. ( [2024](https://arxiv.org/html/2601.03785v3#bib.bib27 "DialSim: a dialogue simulator for evaluating long-term multi-party dialogue understanding of conversational agents")). We report F1 for precision–recall balance in answer generation and BLEU-1 for lexical overlap with references.

### 4.2 Implementation Details

We utilize text-embedding-3-small for text embedding and OpenAI’s GPT-4o and GPT-4o-mini as the backbone LLMs across all experiments.

For a fair comparison, we locally deploy and evaluate A-MEM Xu et al. ( [2025](https://arxiv.org/html/2601.03785v3#bib.bib3 "A-mem: agentic memory for llm agents")) and Mem0 Chhikara et al. ( [2025](https://arxiv.org/html/2601.03785v3#bib.bib4 "Mem0: building production-ready ai agents with scalable long-term memory")), test retrieval depths k∈{5,10,20,30}k\\in\\{5,10,20,30\\}, and report their best scores. For Membox, the main comparison uses fixed content top-k=10k=10 and two inference modes: _Membox-Compact_, which retrieves Topic Loom boxes as evidence, and _Membox-Trace_, which further expands the context with Trace Weaver events from related macro-topic traces using event top-k=2k=2. Retrieval-depth sensitivity is reported in Table [3](https://arxiv.org/html/2601.03785v3#S4.T3 "Table 3 ‣ 4.4 Retrieval-Depth Analysis ‣ 4 Experiment ‣ Membox: Weaving Topic Continuity into Long‑Range Memory for LLM Agents"), and the full trace-expansion sweep in Appendix Table [8](https://arxiv.org/html/2601.03785v3#A1.T8 "Table 8 ‣ A.4 Trace-Expansion Sensitivity ‣ Appendix A Appendix ‣ Membox: Weaving Topic Continuity into Long‑Range Memory for LLM Agents"). The evaluation follows two phases: 1) Memory Construction with each system’s default prompts; 2) QA & Inference with the same backbone LLM.

### 4.3 Empirical Results

Table [1](https://arxiv.org/html/2601.03785v3#S3.T1 "Table 1 ‣ Secondary Trace Initialization. ‣ 3.2 Membox Linking: The Trace Weaver ‣ 3 Method ‣ Membox: Weaving Topic Continuity into Long‑Range Memory for LLM Agents") reports the main LoCoMo comparison. Membox-Compact isolates the effect of Topic Loom: by retrieving locally topic-continuous boxes, it already outperforms strong baselines on most categories across both GPT-4o-mini and GPT-4o. This comparison directly tests whether adding a topic-continuity organization layer before retrieval provides better evidence than increasing retrieval depth over fragmented memory records.

Membox-Trace adds the macro-continuity layer by expanding retrieved boxes with Trace Weaver events. This mode further improves F1 across all four categories for both backbones, with the largest gains on open-domain QA and consistent gains elsewhere. BLEU-1 generally follows the same trend, although GPT-4o shows small tradeoffs on temporal and single-hop BLEU-1. These results indicate that Trace Weaver is not merely a temporal-question add-on; it provides useful cross-episode context when the answer depends on recurring activities, goals, or factual developments.

Overall, the main comparison supports the hierarchical design: Topic Loom provides a compact local evidence substrate, while Trace Weaver offers an optional macro-topic expansion for higher-recall answering. Appendix [A.2](https://arxiv.org/html/2601.03785v3#A1.SS2 "A.2 Additional DialSim Evaluation ‣ Appendix A Appendix ‣ Membox: Weaving Topic Continuity into Long‑Range Memory for LLM Agents") reports an additional DialSim evaluation on multi-speaker dialogue, where the same Compact/Trace pattern yields higher F1 than session retrieval and full-dialogue-context baselines while using far fewer context tokens.

![Refer to caption](https://arxiv.org/html/2601.03785v3/x3.png)Figure 3: Effect of Trace Weaver at inference time. Left: F1 gains from adding trace expansion to compact box retrieval under content top-k=10k=10 and event top-k=2k=2. Right: overall quality–context tradeoff across content top-k∈{5,7,10}k\\in\\{5,7,10\\}; numbers indicate content top-kk, and Trace uses event top-k=2k=2.

### 4.4 Retrieval-Depth Analysis

Table [3](https://arxiv.org/html/2601.03785v3#S4.T3 "Table 3 ‣ 4.4 Retrieval-Depth Analysis ‣ 4 Experiment ‣ Membox: Weaving Topic Continuity into Long‑Range Memory for LLM Agents") compares retrieval-depth sensitivity on GPT-4o-mini. Membox-Compact improves steadily as more Topic Loom boxes are retrieved, but most of the gain appears within the first few boxes: F1 increases from 0.3988 at top-k=1k=1 to 0.4941 at top-k=3k=3, then grows more gradually to 0.5395 at top-k=10k=10. Under comparable QA context budgets, Membox also achieves higher generation quality than Mem0 and A-MEM, suggesting that topic-continuous boxes provide denser evidence than isolated memory records.

Table 3: Overall retrieval-depth comparison on GPT-4o-mini. Membox rows use _Membox-Compact_. All rows are evaluated on 1540 QA instances.

| Method | top-kk | Avg F1 | Avg BLEU-1 | Avg ctx tok |
| --- | --- | --- | --- | --- |
| Mem0 | 5 | 0.3836 | 0.2970 | 331.14 |
| Mem0 | 10 | 0.3986 | 0.3102 | 656.89 |
| Mem0 | 20 | 0.4035 | 0.3155 | 1306.11 |
| Mem0 | 30 | 0.4095 | 0.3193 | 1955.00 |
| A-MEM | 5 | 0.3063 | 0.2524 | 1238.77 |
| A-MEM | 10 | 0.3277 | 0.2926 | 2449.88 |
| A-MEM | 20 | 0.3365 | 0.3273 | 4873.67 |
| A-MEM | 30 | 0.3441 | 0.3488 | 7246.66 |
| Membox-Compact | 1 | 0.3988 | 0.3113 | 310.69 |
| Membox-Compact | 3 | 0.4941 | 0.3818 | 917.03 |
| Membox-Compact | 5 | 0.5172 | 0.3970 | 1538.10 |
| Membox-Compact | 7 | 0.5310 | 0.4070 | 2166.88 |
| Membox-Compact | 10 | 0.5395 | 0.4142 | 3130.72 |

### 4.5 Analysis on Memory Construction

#### Memory Size Analysis

As shown in Table [2](https://arxiv.org/html/2601.03785v3#S3.T2 "Table 2 ‣ 3.3 Retrieval ‣ 3 Method ‣ Membox: Weaving Topic Continuity into Long‑Range Memory for LLM Agents"), the final memory size produced by Membox is comparable to Mem0 and notably smaller than A-MEM, while organizing dialogue into topic-continuous boxes. Each box contains about 4–6 utterances on average, reducing context fragmentation without substantially increasing the memory footprint. Since Mem0 and A-MEM do not construct box units, MB-level statistics are reported only for Membox.

#### LLM Consumption Analysis

Appendix Tables [5](https://arxiv.org/html/2601.03785v3#A1.T5 "Table 5 ‣ A.3 Preprocessing Cost Details ‣ Appendix A Appendix ‣ Membox: Weaving Topic Continuity into Long‑Range Memory for LLM Agents") and [6](https://arxiv.org/html/2601.03785v3#A1.T6 "Table 6 ‣ A.3 Preprocessing Cost Details ‣ Appendix A Appendix ‣ Membox: Weaving Topic Continuity into Long‑Range Memory for LLM Agents") report LLM token consumption during construction and linking. Membox performs lightweight online continuity checks as messages arrive, but structured extraction and memory writing occur at the box level rather than as full per-utterance updates. This explains why Membox consumes fewer LLM tokens per utterance than Mem0 and A-MEM while preserving local dialogue context. The two backbones produce different box partitions, but both maintain the same efficiency pattern.

### 4.6 Analysis on Membox Linking

Tables [5](https://arxiv.org/html/2601.03785v3#A1.T5 "Table 5 ‣ A.3 Preprocessing Cost Details ‣ Appendix A Appendix ‣ Membox: Weaving Topic Continuity into Long‑Range Memory for LLM Agents") and [6](https://arxiv.org/html/2601.03785v3#A1.T6 "Table 6 ‣ A.3 Preprocessing Cost Details ‣ Appendix A Appendix ‣ Membox: Weaving Topic Continuity into Long‑Range Memory for LLM Agents") separate Topic Loom construction from Trace Weaver linking. Linking is more expensive because it verifies event-to-trace assignments against existing global traces, costing about twice the construction stage per box, yet the combined preprocessing cost per utterance remains below the reported Mem0 and A-MEM costs in our implementation.

Fig. [3](https://arxiv.org/html/2601.03785v3#S4.F3 "Figure 3 ‣ 4.3 Empirical Results ‣ 4 Experiment ‣ Membox: Weaving Topic Continuity into Long‑Range Memory for LLM Agents") summarizes the inference-time tradeoff introduced by Trace Weaver. Trace expansion improves overall F1 from 0.5395 to 0.5528 on GPT-4o-mini and from 0.5801 to 0.5971 on GPT-4o. The gain comes with additional context tokens, so Membox can be used either as a compact Topic Loom retriever or as a trace-expanded retriever when higher-recall macro-topic evidence is useful. Detailed mode statistics and the full trace-expansion sweep are provided in Appendix Tables [7](https://arxiv.org/html/2601.03785v3#A1.T7 "Table 7 ‣ A.3 Preprocessing Cost Details ‣ Appendix A Appendix ‣ Membox: Weaving Topic Continuity into Long‑Range Memory for LLM Agents") and [8](https://arxiv.org/html/2601.03785v3#A1.T8 "Table 8 ‣ A.4 Trace-Expansion Sensitivity ‣ Appendix A Appendix ‣ Membox: Weaving Topic Continuity into Long‑Range Memory for LLM Agents").

## 5 Conclusions

This paper addresses the challenge of topic continuity in human–agent dialogue—the tendency for adjacent turns to form coherent thematic episodes. Existing agent memory systems follow a fragmentation–compensation paradigm that first decomposes dialogue into isolated turns or fixed-size chunks and then compensates through similarity-based enrichment or retrieval, resulting in structural discontinuities and biases toward surface‑level similarity rather than topic continuity.
We propose Membox, a hierarchical memory architecture that augments agent memory with a topic-continuity organization layer. The Topic Loom organizes incoming dialogue into locally coherent episodes through sliding-window monitoring, while the Trace Weaver links sealed episodes across discontinuities to recover recurring macro-topics and long-range event timelines.
Experiments on LoCoMo show that Membox improves F1 across the evaluated QA categories over strong baselines such as Mem0 and A‑MEM, while BLEU-1 generally follows the same trend with small metric-specific tradeoffs in a few settings. Compact retrieval demonstrates the value of topic-continuous boxes, while trace-expanded retrieval further improves long-range QA by adding macro-topic evidence. These results demonstrate that modeling topic continuity as a memory-construction principle yields more coherent, efficient, and temporally grounded LLM agents.

## Limitations

Membox represents macro-topic continuity primarily through event-based traces. This design is effective for recurring activities, plans, factual developments, and other long-range dependencies that can be naturally expressed as events. However, real long-term agent memory may also require continuity along other dimensions, such as user preferences, interpersonal relations, affective states, stable personality traits, or evolving constraints that are not always event-like. Our current Trace Weaver therefore should be viewed as one instantiation of the broader topic-continuity organization layer rather than a complete representation of all forms of long-term memory. Extending Membox to support multiple trace types is an important direction for future work.

## References

- S. Arnold, R. Schneider, P. Cudré-Mauroux, F. A. Gers, and A. Löser (2019)SECTOR: a neural model for coherent topic segmentation and classification.
Transactions of the Association for Computational Linguistics7,  pp. 169–184.
External Links: [Document](https://dx.doi.org/10.1162/tacl%5Fa%5F00261 ""),
[Link](https://aclanthology.org/Q19-1011/ "")Cited by: [§2.2](https://arxiv.org/html/2601.03785v3#S2.SS2.p1.1 "2.2 Discourse Topic Segmentation ‣ 2 Related Work ‣ Membox: Weaving Topic Continuity into Long‑Range Memory for LLM Agents").

- A. Asai, Z. Wu, Y. Wang, A. Sil, and H. Hajishirzi (2024)Self-RAG: learning to retrieve, generate, and critique through self-reflection.
In The Twelfth International Conference on Learning Representations,
External Links: [Link](https://openreview.net/forum?id=hSyW5go0v8 "")Cited by: [§2.3](https://arxiv.org/html/2601.03785v3#S2.SS3.p1.1 "2.3 Retrieval-Augmented and Structured Context ‣ 2 Related Work ‣ Membox: Weaving Topic Continuity into Long‑Range Memory for LLM Agents").

- A. D. Baddeley (2000)The episodic buffer: a new component of working memory?.
Trends in Cognitive Sciences4 (11),  pp. 417–423.
Cited by: [§1](https://arxiv.org/html/2601.03785v3#S1.p1.1 "1 Introduction ‣ Membox: Weaving Topic Continuity into Long‑Range Memory for LLM Agents").

- J. Baek, A. F. Aji, and A. Saffari (2023)Knowledge-augmented language model prompting for zero-shot knowledge graph question answering.
In Proceedings of the 1st Workshop on Natural Language Reasoning and Structured Explanations (NLRSE),
pp. 78–106.
External Links: [Link](https://aclanthology.org/2023.nlrse-1.7/ "")Cited by: [§2.3](https://arxiv.org/html/2601.03785v3#S2.SS3.p1.1 "2.3 Retrieval-Augmented and Structured Context ‣ 2 Related Work ‣ Membox: Weaving Topic Continuity into Long‑Range Memory for LLM Agents").

- L. Chen, P. Tong, Z. Jin, Y. Sun, J. Ye, and H. Xiong (2024)Plan-on-graph: self-correcting adaptive planning of large language model on knowledge graphs.
arXiv preprint arXiv:2410.23875.
Cited by: [§2.3](https://arxiv.org/html/2601.03785v3#S2.SS3.p1.1 "2.3 Retrieval-Augmented and Structured Context ‣ 2 Related Work ‣ Membox: Weaving Topic Continuity into Long‑Range Memory for LLM Agents").

- P. Chhikara, D. Khant, S. Aryan, T. Singh, and D. Yadav (2025)Mem0: building production-ready ai agents with scalable long-term memory.
arXiv preprint arXiv:2504.19413.
Cited by: [§1](https://arxiv.org/html/2601.03785v3#S1.p3.1 "1 Introduction ‣ Membox: Weaving Topic Continuity into Long‑Range Memory for LLM Agents"),
[§2.1](https://arxiv.org/html/2601.03785v3#S2.SS1.p1.1 "2.1 Long-Term Memory for LLM Agents ‣ 2 Related Work ‣ Membox: Weaving Topic Continuity into Long‑Range Memory for LLM Agents"),
[§4.1](https://arxiv.org/html/2601.03785v3#S4.SS1.p2.1 "4.1 Dataset and Evaluation ‣ 4 Experiment ‣ Membox: Weaving Topic Continuity into Long‑Range Memory for LLM Agents"),
[§4.2](https://arxiv.org/html/2601.03785v3#S4.SS2.p2.3 "4.2 Implementation Details ‣ 4 Experiment ‣ Membox: Weaving Topic Continuity into Long‑Range Memory for LLM Agents").

- M. Galley, K. R. McKeown, E. Fosler-Lussier, and H. Jing (2003)Discourse segmentation of multi-party conversation.
In Proceedings of the 41st Annual Meeting of the Association for Computational Linguistics,
Sapporo, Japan,  pp. 562–569.
External Links: [Document](https://dx.doi.org/10.3115/1075096.1075167 ""),
[Link](https://aclanthology.org/P03-1071/ "")Cited by: [§2.2](https://arxiv.org/html/2601.03785v3#S2.SS2.p1.1 "2.2 Discourse Topic Segmentation ‣ 2 Related Work ‣ Membox: Weaving Topic Continuity into Long‑Range Memory for LLM Agents").

- Y. Gao, Y. Xiong, X. Gao, K. Jia, J. Pan, Y. Bi, Y. Dai, J. Sun, M. Wang, and H. Wang (2023)Retrieval-augmented generation for large language models: a survey.
arXiv preprint arXiv:2312.109972 (1).
Cited by: [§2.3](https://arxiv.org/html/2601.03785v3#S2.SS3.p1.1 "2.3 Retrieval-Augmented and Structured Context ‣ 2 Related Work ‣ Membox: Weaving Topic Continuity into Long‑Range Memory for LLM Agents").

- B. J. Grosz and C. L. Sidner (1986)Attention, intentions, and the structure of discourse.
Computational Linguistics12 (3),  pp. 175–204.
Cited by: [§1](https://arxiv.org/html/2601.03785v3#S1.p1.1 "1 Introduction ‣ Membox: Weaving Topic Continuity into Long‑Range Memory for LLM Agents").

- M. A. Hearst (1997)Text tiling: segmenting text into multi-paragraph subtopic passages.
Computational Linguistics23 (1),  pp. 33–64.
External Links: [Link](https://aclanthology.org/J97-1003/ "")Cited by: [§2.2](https://arxiv.org/html/2601.03785v3#S2.SS2.p1.1 "2.2 Discourse Topic Segmentation ‣ 2 Related Work ‣ Membox: Weaving Topic Continuity into Long‑Range Memory for LLM Agents").

- J. Jiang, K. Zhou, W. X. Zhao, and J. Wen (2023a)UniKGQA: unified retrieval and reasoning for solving multi-hop question answering over knowledge graph.
In The Eleventh International Conference on Learning Representations,
External Links: [Link](https://openreview.net/forum?id=Z63RvyAZ2Vh "")Cited by: [§2.3](https://arxiv.org/html/2601.03785v3#S2.SS3.p1.1 "2.3 Retrieval-Augmented and Structured Context ‣ 2 Related Work ‣ Membox: Weaving Topic Continuity into Long‑Range Memory for LLM Agents").

- J. Jiang, C. Dong, S. Kurohashi, and A. Aizawa (2023b)SuperDialseg: a large-scale dataset for supervised dialogue segmentation.
In Proceedings of the 2023 Conference on Empirical Methods in Natural Language Processing,
Singapore,  pp. 4086–4101.
External Links: [Document](https://dx.doi.org/10.18653/v1/2023.emnlp-main.249 ""),
[Link](https://aclanthology.org/2023.emnlp-main.249/ "")Cited by: [§2.2](https://arxiv.org/html/2601.03785v3#S2.SS2.p1.1 "2.2 Discourse Topic Segmentation ‣ 2 Related Work ‣ Membox: Weaving Topic Continuity into Long‑Range Memory for LLM Agents").

- Z. Jiang, F. F. Xu, L. Gao, Z. Sun, Q. Liu, J. Dwivedi-Yu, Y. Yang, J. Callan, and G. Neubig (2023c)Active retrieval augmented generation.
In Proceedings of the 2023 Conference on Empirical Methods in Natural Language Processing,
pp. 7969–7992.
Cited by: [§2.3](https://arxiv.org/html/2601.03785v3#S2.SS3.p1.1 "2.3 Retrieval-Augmented and Structured Context ‣ 2 Related Work ‣ Membox: Weaving Topic Continuity into Long‑Range Memory for LLM Agents").

- J. Kim, W. Chay, H. Hwang, D. Kyung, H. Chung, E. Cho, Y. Kwon, Y. Jo, and E. Choi (2024)DialSim: a dialogue simulator for evaluating long-term multi-party dialogue understanding of conversational agents.
arXiv preprint arXiv:2406.13144.
Cited by: [§A.2](https://arxiv.org/html/2601.03785v3#A1.SS2.p1.1 "A.2 Additional DialSim Evaluation ‣ Appendix A Appendix ‣ Membox: Weaving Topic Continuity into Long‑Range Memory for LLM Agents"),
[§4.1](https://arxiv.org/html/2601.03785v3#S4.SS1.p2.1 "4.1 Dataset and Evaluation ‣ 4 Experiment ‣ Membox: Weaving Topic Continuity into Long‑Range Memory for LLM Agents").

- O. Koshorek, A. Cohen, N. Mor, M. Rotman, and J. Berant (2018)Text segmentation as a supervised learning task.
In Proceedings of the 2018 Conference of the North American Chapter of the Association for Computational Linguistics: Human Language Technologies, Volume 2 (Short Papers),
New Orleans, Louisiana,  pp. 469–473.
External Links: [Document](https://dx.doi.org/10.18653/v1/N18-2075 ""),
[Link](https://aclanthology.org/N18-2075/ "")Cited by: [§2.2](https://arxiv.org/html/2601.03785v3#S2.SS2.p1.1 "2.2 Discourse Topic Segmentation ‣ 2 Related Work ‣ Membox: Weaving Topic Continuity into Long‑Range Memory for LLM Agents").

- K. Lee, X. Chen, H. Furuta, J. Canny, and I. Fischer (2024)A human-inspired reading agent with gist memory of very long contexts.
arXiv preprint arXiv:2402.09727.
Cited by: [§2.1](https://arxiv.org/html/2601.03785v3#S2.SS1.p1.1 "2.1 Long-Term Memory for LLM Agents ‣ 2 Related Work ‣ Membox: Weaving Topic Continuity into Long‑Range Memory for LLM Agents"),
[§4.1](https://arxiv.org/html/2601.03785v3#S4.SS1.p2.1 "4.1 Dataset and Evaluation ‣ 4 Experiment ‣ Membox: Weaving Topic Continuity into Long‑Range Memory for LLM Agents").

- P. Lewis, E. Perez, A. Piktus, F. Petroni, V. Karpukhin, N. Goyal, H. Küttler, M. Lewis, W. Yih, T. Rocktäschel, S. Riedel, and D. Kiela (2020)Retrieval-augmented generation for knowledge-intensive nlp tasks.
Advances in Neural Information Processing Systems33,  pp. 9459–9474.
Cited by: [§2.3](https://arxiv.org/html/2601.03785v3#S2.SS3.p1.1 "2.3 Retrieval-Augmented and Structured Context ‣ 2 Related Work ‣ Membox: Weaving Topic Continuity into Long‑Range Memory for LLM Agents").

- J. Linders and J. M. Tomczak (2025)Knowledge graph-extended retrieval augmented generation for question answering.
Applied Intelligence55 (17),  pp. 1102.
External Links: [Document](https://dx.doi.org/10.1007/s10489-025-06885-5 "")Cited by: [§2.3](https://arxiv.org/html/2601.03785v3#S2.SS3.p1.1 "2.3 Retrieval-Augmented and Structured Context ‣ 2 Related Work ‣ Membox: Weaving Topic Continuity into Long‑Range Memory for LLM Agents").

- M. Lukasik, B. Dadachev, K. Papineni, and G. Simões (2020)Text segmentation by cross segment attention.
In Proceedings of the 2020 Conference on Empirical Methods in Natural Language Processing (EMNLP),
Online,  pp. 4707–4716.
External Links: [Document](https://dx.doi.org/10.18653/v1/2020.emnlp-main.380 ""),
[Link](https://aclanthology.org/2020.emnlp-main.380/ "")Cited by: [§2.2](https://arxiv.org/html/2601.03785v3#S2.SS2.p1.1 "2.2 Discourse Topic Segmentation ‣ 2 Related Work ‣ Membox: Weaving Topic Continuity into Long‑Range Memory for LLM Agents").

- A. Maharana, D. Lee, S. Tulyakov, M. Bansal, F. Barbieri, and Y. Fang (2024)Evaluating very long-term conversational memory of llm agents.
arXiv preprint arXiv:2402.17753.
Cited by: [§4.1](https://arxiv.org/html/2601.03785v3#S4.SS1.p1.1 "4.1 Dataset and Evaluation ‣ 4 Experiment ‣ Membox: Weaving Topic Continuity into Long‑Range Memory for LLM Agents"),
[§4.1](https://arxiv.org/html/2601.03785v3#S4.SS1.p2.1 "4.1 Dataset and Evaluation ‣ 4 Experiment ‣ Membox: Weaving Topic Continuity into Long‑Range Memory for LLM Agents").

- G. A. Miller (1956)The magical number seven, plus or minus two: some limits on our capacity for processing information.
Psychological Review63 (2),  pp. 81–97.
External Links: [Document](https://dx.doi.org/10.1037/h0043158 "")Cited by: [§1](https://arxiv.org/html/2601.03785v3#S1.p1.1 "1 Introduction ‣ Membox: Weaving Topic Continuity into Long‑Range Memory for LLM Agents").

- A. Modarressi, A. Imani, M. Fayyaz, and H. Schütze (2023)Ret-llm: towards a general read-write memory for large language models.
arXiv preprint arXiv:2305.14322.
Cited by: [§2.1](https://arxiv.org/html/2601.03785v3#S2.SS1.p1.1 "2.1 Long-Term Memory for LLM Agents ‣ 2 Related Work ‣ Membox: Weaving Topic Continuity into Long‑Range Memory for LLM Agents").

- C. Packer, S. Wooders, K. Lin, V. Fang, S. G. Patil, I. Stoica, and J. E. Gonzalez (2023)MemGPT: towards LLMs as operating systems.
arXiv preprint arXiv:2310.08560.
Cited by: [§2.1](https://arxiv.org/html/2601.03785v3#S2.SS1.p1.1 "2.1 Long-Term Memory for LLM Agents ‣ 2 Related Work ‣ Membox: Weaving Topic Continuity into Long‑Range Memory for LLM Agents"),
[§4.1](https://arxiv.org/html/2601.03785v3#S4.SS1.p2.1 "4.1 Dataset and Evaluation ‣ 4 Experiment ‣ Membox: Weaving Topic Continuity into Long‑Range Memory for LLM Agents").

- D. Schiffrin (1994)Approaches to discourse.
Blackwell, Oxford.
Cited by: [§1](https://arxiv.org/html/2601.03785v3#S1.p1.1 "1 Introduction ‣ Membox: Weaving Topic Continuity into Long‑Range Memory for LLM Agents").

- J. Sun, C. Xu, L. Tang, S. Wang, C. Lin, Y. Gong, L. M. Ni, H. Shum, and J. Guo (2024)Think-on-graph: deep and responsible reasoning of large language model on knowledge graph.
In Proceedings of the 2024 International Conference on Learning Representations (ICLR),
Cited by: [§2.3](https://arxiv.org/html/2601.03785v3#S2.SS3.p1.1 "2.3 Retrieval-Augmented and Structured Context ‣ 2 Related Work ‣ Membox: Weaving Topic Continuity into Long‑Range Memory for LLM Agents").

- E. Tulving (1983)Elements of episodic memory.
Oxford University Press, Oxford.
Cited by: [§1](https://arxiv.org/html/2601.03785v3#S1.p1.1 "1 Introduction ‣ Membox: Weaving Topic Continuity into Long‑Range Memory for LLM Agents").

- B. Wang, X. Liang, J. Yang, H. Huang, S. Wu, P. Wu, L. Lu, Z. Ma, and Z. Li (2023)Enhancing large language model with self-controlled memory framework.
arXiv preprint arXiv:2304.13343.
Cited by: [§2.1](https://arxiv.org/html/2601.03785v3#S2.SS1.p1.1 "2.1 Long-Term Memory for LLM Agents ‣ 2 Related Work ‣ Membox: Weaving Topic Continuity into Long‑Range Memory for LLM Agents").

- W. Xu, Z. Liang, K. Mei, H. Gao, J. Tan, and Y. Zhang (2025)A-mem: agentic memory for llm agents.
arXiv preprint arXiv:2502.12110.
Cited by: [§1](https://arxiv.org/html/2601.03785v3#S1.p3.1 "1 Introduction ‣ Membox: Weaving Topic Continuity into Long‑Range Memory for LLM Agents"),
[§2.1](https://arxiv.org/html/2601.03785v3#S2.SS1.p1.1 "2.1 Long-Term Memory for LLM Agents ‣ 2 Related Work ‣ Membox: Weaving Topic Continuity into Long‑Range Memory for LLM Agents"),
[§4.1](https://arxiv.org/html/2601.03785v3#S4.SS1.p2.1 "4.1 Dataset and Evaluation ‣ 4 Experiment ‣ Membox: Weaving Topic Continuity into Long‑Range Memory for LLM Agents"),
[§4.2](https://arxiv.org/html/2601.03785v3#S4.SS2.p2.3 "4.2 Implementation Details ‣ 4 Experiment ‣ Membox: Weaving Topic Continuity into Long‑Range Memory for LLM Agents").

- W. Zhong, L. Guo, Q. Gao, H. Ye, and Y. Wang (2024)MemoryBank: enhancing large language models with long-term memory.
Proceedings of the AAAI Conference on Artificial Intelligence38 (17),  pp. 19724–19731.
External Links: [Document](https://dx.doi.org/10.1609/aaai.v38i17.29946 ""),
[Link](https://ojs.aaai.org/index.php/AAAI/article/view/29946 "")Cited by: [§1](https://arxiv.org/html/2601.03785v3#S1.p3.1 "1 Introduction ‣ Membox: Weaving Topic Continuity into Long‑Range Memory for LLM Agents"),
[§2.1](https://arxiv.org/html/2601.03785v3#S2.SS1.p1.1 "2.1 Long-Term Memory for LLM Agents ‣ 2 Related Work ‣ Membox: Weaving Topic Continuity into Long‑Range Memory for LLM Agents"),
[§4.1](https://arxiv.org/html/2601.03785v3#S4.SS1.p2.1 "4.1 Dataset and Evaluation ‣ 4 Experiment ‣ Membox: Weaving Topic Continuity into Long‑Range Memory for LLM Agents").


## Appendix A Appendix

### A.1 LLM Usage Statement

The large language model was used solely for grammar checks and polishing, and no other purposes.

### A.2 Additional DialSim Evaluation

To test whether the observed gains transfer beyond LoCoMo, we additionally evaluate Membox on the Friends subset of DialSim Kim et al. ( [2024](https://arxiv.org/html/2601.03785v3#bib.bib27 "DialSim: a dialogue simulator for evaluating long-term multi-party dialogue understanding of conversational agents")), a multi-speaker casual-dialogue benchmark. We use dialogues from Seasons 1–5, covering 118 episodes. For each episode, we sample 5 easy and 5 hard questions, yielding 1025 questions after duplicate removal. QA uses GPT-4o-mini with embedding-based retrieval. To avoid prompt tuning to the new benchmark, we reuse the LoCoMo memory-construction prompts; the answering prompt follows the DialSim paper. DialSim also includes unanswerable cases with gold answer sets, so they can be evaluated with standard F1.

Table 4: Additional DialSim results on Friends. Membox rows use top-10 retrieval. Baseline results are from the DialSim paper; context tokens for Session Retrieval are not reported there.

| Method | Avg F1 | Avg ctx tok |
| --- | --- | --- |
| Session Retrieval | 45.47 | – |
| Full Dialogue Context | 48.11 | ∼\\sim128k |
| Membox-Compact | 52.78 | 826.53 |
| Membox-Trace | 55.33 | 1872.54 |

As shown in Table [4](https://arxiv.org/html/2601.03785v3#A1.T4 "Table 4 ‣ A.2 Additional DialSim Evaluation ‣ Appendix A Appendix ‣ Membox: Weaving Topic Continuity into Long‑Range Memory for LLM Agents"), Membox-Compact outperforms the DialSim baselines while using 826.53 average context tokens, compared with approximately 128k tokens for full-dialogue context. Trace expansion further improves F1 to 55.33 with 1872.54 average context tokens. Since DialSim contains multi-speaker casual conversations and the prompts are not tuned for it, these results suggest that hierarchical topic-continuity memory is not specific to LoCoMo.

### A.3 Preprocessing Cost Details

Tables [5](https://arxiv.org/html/2601.03785v3#A1.T5 "Table 5 ‣ A.3 Preprocessing Cost Details ‣ Appendix A Appendix ‣ Membox: Weaving Topic Continuity into Long‑Range Memory for LLM Agents") and [6](https://arxiv.org/html/2601.03785v3#A1.T6 "Table 6 ‣ A.3 Preprocessing Cost Details ‣ Appendix A Appendix ‣ Membox: Weaving Topic Continuity into Long‑Range Memory for LLM Agents") report detailed LLM usage during memory construction and trace linking. They complement the main analysis by separating the online Topic Loom construction cost from the Trace Weaver linking cost.

Table 5:
LLM call statistics during memory base construction.
MB#: Membox count;
Tok/MB: LLM tokens consumed per Membox;
Tok/Ut: LLM tokens consumed per utterance.

| Method | MB# | Tok/MB | Tok/Ut |
| --- | --- | --- | --- |
| Mem0 w/ GPT-4o-mini | - | - | 2115.85 |
| Mem0 w/ GPT-4o | - | - | 1923.17 |
| A-MEM w/ GPT-4o-mini | - | - | 1755.57 |
| A-MEM w/ GPT-4o | - | - | 1526.39 |
| Membox w/ GPT-4o-mini | 892 | 1557.44 | 236.18 |
| Membox w/ GPT-4o | 1206 | 1241.61 | 254.57 |

Table 6:
LLM usage statistics for Membox linking.
MB#: Membox count;
Calls/MB: LLM calls per Membox;
Tok/MB: tokens consumed per Membox.

| Model | MB# | Calls/MB | Tok/MB |
| --- | --- | --- | --- |
| GPT-4o-mini | 892 | 2.30 | 3133.56 |
| GPT-4o | 1206 | 0.88 | 2716.89 |

Table 7: Overall quality–context tradeoff for the two Membox inference modes. Both modes use content top-k=10k=10; Trace additionally uses event top-k=2k=2. Ctx denotes average QA context tokens.

| Model | Mode | F1 | BLEU-1 | Ctx |
| --- | --- | --- | --- | --- |
| GPT-4o-mini | Compact | 0.5395 | 0.4142 | 3130.72 |
| GPT-4o-mini | Trace | 0.5528 | 0.4289 | 4108.85 |
| GPT-4o | Compact | 0.5801 | 0.4621 | 2390.16 |
| GPT-4o | Trace | 0.5971 | 0.4676 | 6887.84 |

### A.4 Trace-Expansion Sensitivity

Table [8](https://arxiv.org/html/2601.03785v3#A1.T8 "Table 8 ‣ A.4 Trace-Expansion Sensitivity ‣ Appendix A Appendix ‣ Membox: Weaving Topic Continuity into Long‑Range Memory for LLM Agents") reports the full sensitivity sweep for trace-expanded retrieval. Across both GPT-4o and GPT-4o-mini, adding Trace Weaver evidence consistently improves over compact box retrieval at the same content top-kk, confirming that macro-topic traces provide useful long-range evidence beyond the retrieved local episodes. Increasing the event top-kk generally raises F1 but also increases context length, so the main experiments use event top-k=2k=2 as a balanced setting: it captures most of the trace benefit without adding all linked events to the QA context.

Table 8: Full overall sensitivity of Compact and Trace inference modes. Trace rows use the same content retrieval as Compact and vary the event top-kk. All rows are evaluated on 1540 QA instances.

| Model | Mode | Content top-kk | Event top-kk | Avg F1 | Avg BLEU-1 | Avg ctx tok |
| --- | --- | --- | --- | --- | --- | --- |
| GPT-4o | Compact | 5 | – | 0.5539 | 0.4394 | 1196.79 |
| GPT-4o | Compact | 7 | – | 0.5703 | 0.4505 | 1674.21 |
| GPT-4o | Compact | 10 | – | 0.5801 | 0.4621 | 2390.16 |
| GPT-4o | Trace | 5 | 1 | 0.5826 | 0.4616 | 5362.73 |
| GPT-4o | Trace | 7 | 1 | 0.5881 | 0.4617 | 5827.23 |
| GPT-4o | Trace | 10 | 1 | 0.5908 | 0.4643 | 6555.07 |
| GPT-4o | Trace | 5 | 2 | 0.5882 | 0.4664 | 5652.71 |
| GPT-4o | Trace | 7 | 2 | 0.5921 | 0.4649 | 6155.77 |
| GPT-4o | Trace | 10 | 2 | 0.5971 | 0.4676 | 6887.84 |
| GPT-4o | Trace | 5 | all | 0.5960 | 0.4711 | 5928.89 |
| GPT-4o | Trace | 7 | all | 0.5919 | 0.4646 | 6459.29 |
| GPT-4o | Trace | 10 | all | 0.5986 | 0.4697 | 7225.96 |
| GPT-4o-mini | Compact | 5 | – | 0.5172 | 0.3970 | 1538.10 |
| GPT-4o-mini | Compact | 7 | – | 0.5310 | 0.4070 | 2166.88 |
| GPT-4o-mini | Compact | 10 | – | 0.5395 | 0.4142 | 3130.72 |
| GPT-4o-mini | Trace | 5 | 1 | 0.5301 | 0.4164 | 2268.74 |
| GPT-4o-mini | Trace | 7 | 1 | 0.5369 | 0.4187 | 2900.56 |
| GPT-4o-mini | Trace | 10 | 1 | 0.5463 | 0.4253 | 3858.10 |
| GPT-4o-mini | Trace | 5 | 2 | 0.5334 | 0.4185 | 2515.48 |
| GPT-4o-mini | Trace | 7 | 2 | 0.5400 | 0.4217 | 3146.83 |
| GPT-4o-mini | Trace | 10 | 2 | 0.5528 | 0.4289 | 4108.85 |
| GPT-4o-mini | Trace | 5 | all | 0.5400 | 0.4193 | 4042.98 |
| GPT-4o-mini | Trace | 7 | all | 0.5447 | 0.4209 | 5065.46 |
| GPT-4o-mini | Trace | 10 | all | 0.5560 | 0.4295 | 6527.00 |

### A.5 Category-Level Retrieval-Depth Sensitivity

Figure [4](https://arxiv.org/html/2601.03785v3#A1.F4 "Figure 4 ‣ A.5 Category-Level Retrieval-Depth Sensitivity ‣ Appendix A Appendix ‣ Membox: Weaving Topic Continuity into Long‑Range Memory for LLM Agents") provides a category-level view of retrieval-depth sensitivity for Membox-Compact with GPT-4o-mini. The plots vary the number of retrieved Topic Loom boxes while keeping the retrieval mode fixed to compact box retrieval, so they isolate how much local topic-continuous evidence is needed for each question type.

Temporal and single-hop questions benefit steadily from larger retrieval depth, suggesting that additional topic-continuous boxes provide useful supporting evidence for event order, duration, and factual lookup. Multi-hop questions improve sharply from top-1 to top-7 and then saturate, indicating that a small set of coherent episodes already captures most of the required evidence. Open-domain questions peak around top-5 and then slightly decline, which suggests that adding more dialogue context can introduce distractors when the answer also depends on external commonsense knowledge. Overall, the category-level trends support the main retrieval-depth analysis: retrieving a few topic-continuous boxes yields most of the gain, while larger top-kk values mainly trade additional evidence for more context.

![Refer to caption](https://arxiv.org/html/2601.03785v3/category_1_metrics.png)(a) Multi-hop

![Refer to caption](https://arxiv.org/html/2601.03785v3/category_2_metrics.png)(b) Temporal

![Refer to caption](https://arxiv.org/html/2601.03785v3/category_3_metrics.png)(c) Open-domain

![Refer to caption](https://arxiv.org/html/2601.03785v3/category_4_metrics.png)(d) Single-hop

Figure 4: Category-level retrieval-depth sensitivity for Membox-Compact with GPT-4o-mini on LoCoMo. Top-NN denotes the number of retrieved Topic Loom boxes.

### A.6 Prompt Templates

In this study, four types of prompts are employed, each serving a distinct function. PROMPT\_MSG\_CONTINUATION (Table [9](https://arxiv.org/html/2601.03785v3#A1.T9 "Table 9 ‣ A.6 Prompt Templates ‣ Appendix A Appendix ‣ Membox: Weaving Topic Continuity into Long‑Range Memory for LLM Agents")) is used during memory construction to determine whether the current dialogue is continuous with the previous context, thereby deciding whether the active topic-continuous episode should be extended or sealed. PROMPT\_DIALOG\_EXTRACT (Table [10](https://arxiv.org/html/2601.03785v3#A1.T10.fig1 "Table 10 ‣ A.6 Prompt Templates ‣ Appendix A Appendix ‣ Membox: Weaving Topic Continuity into Long‑Range Memory for LLM Agents")) extracts key information from the dialogue and converts it into a structured format stored in the memory module. PROMPT\_TRACE\_EVENT\_FILTER (Table [11](https://arxiv.org/html/2601.03785v3#A1.T11 "Table 11 ‣ A.6 Prompt Templates ‣ Appendix A Appendix ‣ Membox: Weaving Topic Continuity into Long‑Range Memory for LLM Agents")) and PROMPT\_TRACE\_INIT (Table [12](https://arxiv.org/html/2601.03785v3#A1.T12 "Table 12 ‣ A.6 Prompt Templates ‣ Appendix A Appendix ‣ Membox: Weaving Topic Continuity into Long‑Range Memory for LLM Agents")) are used to construct event traces.

| PROMPT MSG CONTINUATION |
| --- |
| Please determine whether the current message continues with the main topic of the previous messages. Only answer Yes/No/Partially Shifted. |
| previous messages: ref |
| current message: curr |
| Answer: |

Table 9: PROMPT MSG CONTINUATION

| PROMPT DIALOG EXTRACT |
| --- |
| Please analyze the relationships between the following entities in the given sentence. |
| Generate a structured analysis of the provided dialog by performing the following tasks: |
| 1\. Identifying salient keywords: Extract 3-8 most salient nouns, named entities, and key terminology that represent core concepts. Avoid common words (e.g., “good”, “see”) and prioritize specificity. |
| 2\. Determining the core topic: In one clear phrase, state the primary subject or objective of the discussion based on the actual content. |
| 3\. Extracting explicit event and plan mentions: Identify and list only the events, factual developments, or specific future plans that are explicitly mentioned in the dialog. Follow these strict rules: |
| 3.1. Focus on Verbatim or Near-Verbatim Content: Each extracted item must be directly grounded in the dialog text. Do not infer, summarize, or combine information to create new “events.” |
| 3.2. Distinguish Event Types: |
| \- Past/Completed Events: Actions or occurrences that are stated as having happened (e.g., “I went to…”, “We completed the project”). |
| \- Established Facts/Changes: Concrete facts or changes presented as already true (e.g., “I am now the team lead”, “The system is down”). |
| \- Explicit Future Plans: Specific plans for the future mentioned by the speakers (e.g., “We will meet on Friday”, “I’m planning to visit Paris”). |
| 3.3. Exclude Non-Events: Do NOT include: |
| \- General states of being (e.g., “I’m swamped”, “I’m happy”). |
| \- Questions, greetings, or expressions of intent without a plan (e.g., “We should talk sometime”). |
| \- Vague aspirations or possibilities. |
| 3.4. Framing: Phrase each extracted item as a concise, standalone clause that captures the core of what was mentioned. |
| Output Format: Provide the analysis as a valid JSON object with the following exact keys: |
| ```<br>{<br>  "keywords": [<br>    "keyword1",<br>    "keyword2",<br>    ...<br>  ],<br>  "topic": "clear topic phrase",<br>  "explicit_mentions": [<br>    "A mentioned past event or established fact",<br>    "A mentioned specific future plan"<br>  ]<br>}<br>    <br>```<br>Content to analyze: {text} |

Table 10: PROMPT DIALOG EXTRACT

| PROMPT\_TRACE\_EVENT\_FILTER |
| --- |
| You are a narrative coherence analyzer for constructing and maintaining event memory chains. Your task is to filter events from a new event list (Event List B) that are directly related to an existing event chain (Event Chain A). |
| Core Task: |
| Event Chain A represents an existing sequence of events (could be one or multiple events). Event List B is a set of newly observed events. Analyze each event in B to determine whether it should: |
| 1\. Serve as a direct continuation of Event Chain A (directly related to A’s core narrative) |
| 2\. Be considered unrelated to Event Chain A (independent or belonging to a different event stream) |
| Analysis Principles: |
| \- Identify the core theme/activity from Event Chain A’s overall narrative |
| \- Assess narrative continuity: Does the event from B advance, develop, or resolve A’s core activity? |
| \- Consider temporal/causal logic: Does the event naturally follow A’s chain in time or logic? |
| Decision Criteria: |
| An event from B is related to Event Chain A if it: |
| 1\. Continues the same core activity as A’s chain (not just similar topic) |
| 2\. Provides progress, outcome, solution, or direct consequence to A’s chain |
| 3\. Is a logical/temporal successor to A’s chain |
| An event from B is unrelated to Event Chain A if it: |
| 1\. Initiates a new, distinct activity (even if topic is similar) |
| 2\. Is a parallel but independent event to A’s core activity |
| 3\. Concerns a different aspect unrelated to A’s main thread |
| 4\. Is a generic response without specific progression |
| Output Format: |
| Strictly use this JSON format: |
| ```<br>{<br>    "chain_summary": "Brief summary of Event Chain A’s core theme (1-2 sentences)",<br>    "related_events": ["Exact text of related events from B"],<br>    "unrelated_events": ["Exact text of unrelated events from B"],<br>    "reasoning": {<br>        "related_reasons": ["Brief explanation for each related event"],<br>        "unrelated_reasons": ["Brief explanation for each unrelated event"]<br>    }<br>}<br>``` |
| Example 1: |
| Event Chain A: \["I’m planning a weekend hike", "I checked the weather forecast", "I bought hiking shoes"\] |
| Event List B: \["I mapped out the hiking route", "I replied to work emails", "I contacted hiking partners", "Went to see a movie in the evening"\] |
| Output: |
| ```<br>{<br>    "chain_summary": "Preparations for a weekend hiking trip",<br>    "related_events": ["I mapped out the hiking route", "I contacted hiking partners"],<br>    "unrelated_events": ["I replied to work emails", "Went to see a movie in the evening"],<br>    "reasoning": {<br>        "related_reasons": [<br>            "Mapping the route is a concrete step in hike preparation",<br>            "Contacting partners directly advances the hiking activity"<br>        ],<br>        "unrelated_reasons": [<br>            "Work emails concern a different domain (work vs. recreation)",<br>            "Movie watching is a separate leisure activity"<br>        ]<br>    }<br>}<br>``` |
| Example 2: |
| Event Chain A: \["The project encountered technical difficulties", "The team met to discuss solutions"\] |
| Event List B: \["I researched relevant documentation", "Decided to adopt a new framework", "Had pizza for lunch", "Client sent new requirements"\] |
| Output: |
| ```<br>{<br>    "chain_summary": "Addressing technical challenges in a project",<br>    "related_events": ["I researched relevant documentation", "Decided to adopt a new framework"],<br>    "unrelated_events": ["Had pizza for lunch", "Client sent new requirements"],<br>    "reasoning": {<br>        "related_reasons": [<br>            "Researching documentation directly addresses the technical problem",<br>            "Deciding on a new framework represents a solution to the technical challenge"<br>        ],<br>        "unrelated_reasons": [<br>            "Lunch is a routine activity unrelated to problem-solving",<br>            "New client requirements initiate a separate work thread"<br>        ]<br>    }<br>}<br>``` |
| Now analyze: |
| Event Chain A: {content\_a} (Note: This is an existing event chain) |
| Event List B: {content\_b} (Note: This is a new event list) |
| Output your analysis. |

Table 11: PROMPT\_TRACE\_EVENT\_FILTER

| PROMPT TRACE INIT |
| --- |
| You are an event chain constructor for building coherent memory structures. Your task is to analyze a set of events and organize them into logical chains. |
| Task: |
| Given a set of events, identify the primary narrative thread and any associated events that form a coherent event chain. |
| Process: |
| 1\. Analyze all events to identify the most prominent theme or activity |
| 2\. Connect events that share temporal, causal, or thematic relationships |
| 3\. Form the most coherent sequence possible |
| 4\. Identify any events that don’t fit into the main narrative thread |
| Output Format: |
| { "primary\_chain": \["Events forming the most coherent narrative, in logical order"\], "secondary\_chains": \[\["Other potential chains, if any"\]\], "isolated\_events": \["Events that don’t fit into any chain"\], "chain\_summary": "Brief description of the primary chain’s theme and context"} |
| Examples: |
| Example 1: |
| Events: \["I woke up at 7 AM", "I checked my email", "I had breakfast", "Then I went for a run"\] |
| Output: |
| { "primary\_chain": \["I woke up at 7 AM", "I had breakfast", "Then I went for a run"\], "secondary\_chains": \[\], "isolated\_events": \["I checked my email"\], "chain\_summary": "Morning routine including waking, eating, and exercise"} |
| Example 2: |
| Events: \["Started a new project at work", "Researched design patterns", "Met with the client", "Created initial wireframes", "Had lunch with a colleague"\] |
| Output: |
| { "primary\_chain": \["Started a new project at work", "Researched design patterns", "Created initial wireframes"\], "secondary\_chains": \[\["Met with the client"\]\], "isolated\_events": \["Had lunch with a colleague"\], "chain\_summary": "Work project initiation and initial design phase"} |
| Now analyze: |
| Events: {events} |
| Output your analysis in JSON format. |

Table 12: PROMPT TRACE INIT

BETA