HTML conversions sometimes display errors due to content that did not convert correctly from the source. This paper uses the following packages that are not yet supported by the HTML conversion tool. Feedback on these issues are not necessary; they are known and are being worked on.

failed: datetime2.sty
failed: xltabular.sty
Authors: achieve the best HTML results from your LaTeX submissions by following these best practices.

License: arXiv.org perpetual non-exclusive license
arXiv:2510.24699v1 [cs.CL] 28 Oct 2025
\useunder
\ul

[Uncaptioned image]  
AgentFold: Long-Horizon Web Agents with
Proactive Context Management
 
Rui Ye∗
(
✉
)
, Zhongwang Zhang , Kuan Li∗, Huifeng Yin∗
(
✉
)

Zhengwei Tao, Yida Zhao, Liangcai Su, Liwen Zhang, Zile Qiao, Xinyu Wang Pengjun Xie, Fei Huang, Siheng Chen, Jingren Zhou, Yong Jiang
(
✉
)

Tongyi Lab[Uncaptioned image] , Alibaba Group
Equal Core Contributors.
Abstract
LLM-based web agents show immense promise for information seeking, yet their effectiveness on long-horizon tasks is hindered by a fundamental trade-off in context management. Prevailing ReAct-based agents suffer from context saturation as they accumulate noisy, raw histories, while methods that fixedly summarize the full history at each step risk the irreversible loss of critical details. Addressing these, we introduce AgentFold, a novel agent paradigm centered on proactive context management, inspired by the human cognitive process of retrospective consolidation. AgentFold treats its context as a dynamic cognitive workspace to be actively sculpted, rather than a passive log to be filled. At each step, it learns to execute a ‘folding’ operation, which manages its historical trajectory at multiple scales: it can perform granular condensations to preserve vital, fine-grained details, or deep consolidations to abstract away entire multi-step sub-tasks. The results on prominent benchmarks are striking: with simple supervised fine-tuning (without continual pre-training or RL), our AgentFold-30B-A3B agent achieves 36.2% on BrowseComp and 47.3% on BrowseComp-ZH. Notably, this performance not only surpasses or matches open-source models of a dramatically larger scale, such as the DeepSeek-V3.1-671B-A37B, but also surpasses leading proprietary agents like OpenAI’s o4-mini.

✉Corresponding Authors. yr991129@sjtu.edu.cn {yinhuifeng.yhf, yongjiang.jy}@alibaba-inc.com
Refer to caption
Figure 1:Our AgentFold-30B-A3B agent demonstrates remarkable performance on challenging long-horizon benchmarks, matching or surpassing agents with significantly larger model sizes. This is enabled by its proactive context folding, which maintains a highly concise and focused context that reaches only 7k tokens after 100 turns of interaction and is capable of scaling to 500 turns.
1Introduction
The ability to effectively seek and synthesize web information (Marchionini, 1995; Given et al., 2023) is foundational to modern progress. This critical process, however, is fundamentally constrained by inherent human limitations in cognitive capacity and endurance. The advent of LLM-based web agents marks a paradigm shift, offering systems that transcend these boundaries to tirelessly navigate the digital landscape and dramatically enhancing the efficiency and effectiveness of complex information-seeking tasks (OpenAI, 2025a; Comanici et al., 2025).

However, a critical challenge for contemporary web agents lies in striking an effective balance between context comprehensiveness and conciseness, a trade-off that significantly impacts their performance, especially on long-horizon tasks (Wei et al., 2025; Wong et al., 2025). (1) Prevailing ReAct-based agents (Yao et al., 2023; Wu et al., 2025; Li et al., 2025b), which accumulate the entire history of reasoning-action-observation triplets in their context, preserve informational integrity but severely suffer from the overwhelming noise of raw web data, leading to suboptimal actions. (2) Conversely, recent approaches (Zhou et al., 2025b; Yu et al., 2025; Wang et al., 2025) that mechanically summarize the full history at every step maintain a clean context but risk the premature and irreversible loss of crucial details during any single summarization phase. These fundamental limitations reveal a critical gap in current methodologies, signaling the necessity for a next-generation agent paradigm with advanced context management.

In this paper, we posit that an ideal agent should manage its internal context like a human’s mental scratchpad: a workspace to be actively managed, not passively filled (Miller, 1956). Human problem-solving entails neither the exhaustive retention of all information nor its rigid, step-wise summarization. Instead, it is a process of disciplined, retrospective consolidation performed at critical points. This involves a dynamic ‘look-back’ mechanism: after several actions, irrelevant steps are discarded, intermediate findings are distilled, and key insights are abstracted (Newell et al., 1972). This self-correcting act of consolidation is what enables effective and sustained reasoning, a capability we believe is essential for effective long-horizon reasoning and exploration in an agent.

Following this spirit, we introduce AgentFold, an agent architected to proactively and intelligently ‘fold’ segments of context during task execution. It operates not on a monolithic log, but on a dynamic trajectory composed of Multi-Scale State Summaries—several distilled records of past events—and the Latest Interaction, which is the complete record of the most recent action and observation. At each intermediate step of task-solving trajectory, AgentFold conducts deep reasoning that leads to two concurrent outputs: a folding directive and a tool call. This folding directive has a dual (two-scale) character: (1) as a granular condensation, it crystallizes the Latest Interaction into a new state summary, appending it to the sequence of State Summaries; (2) or as a deep consolidation, it fuses the Latest Interaction with a chain of prior summaries, retracting these specific entries and replacing them with a single abstraction at a coarser strategic scale. This is powerful for maintaining logical coherence and conciseness, for instance, by packaging a completed sub-investigation into its final conclusion. Simultaneously, the resulting observation from the executed tool call then, combined with the action, constitutes the new Latest Interaction for the subsequent cycle. By choosing what and how much to fold, AgentFold transcends the brutal trade-off between retaining noisy details and risking catastrophic information loss. This capability equips AgentFold with a focused and deeply informed reasoning process, essential for conquering long-horizon challenges.

Training AgentFold requires a dataset that does not yet exist: trajectories that demonstrate a sophisticated interplay of situational action and strategic context curation. To this end, we develop Fold-Generator, a specialized LLM-oriented data collection pipeline that can automatically generate trajectories for training. Recognizing that even the most advanced LLMs cannot reliably produce AgentFold’s structured, multi-part responses through prompt engineering along, we leverage a series of rejection sampling mechanism and finally fine-tunes AgentFold based on open-source LLMs.

To validate our folding paradigm, we implement AgentFold by conducting supervised fine-tuning on the Qwen3-30B-A3B model (Yang et al., 2025). The results on prominent information-seeking benchmarks are striking. Our resulting AgentFold-30B-A3B achieves state-of-the-art performance, scoring 36.2% on BrowseComp (Wei et al., 2025), 47.3% on BrowseComp-ZH (Zhou et al., 2025a), 62.1% on WideSearch (Wong et al., 2025), and 67.0% on general benchmark GAIA (Mialon et al., 2023). Notably, this performance not only surpasses leading proprietary agents like OpenAI’s o4-mini (OpenAI, 2025b) but also matches or surpasses open-source models of a dramatically larger scale, such as the GLM-4.5-355B-A32B (Zeng et al., 2025) and the DeepSeek-V3.1-671B-A37B (DeepSeek Team, 2025).

2Related Works
Web Agents. The advent of LLM-based web agents marks a paradigm shift how human seeks information, as these agents could tirelessly and broadly search and synthesize web information. Pioneering efforts such as OpenAI’s deep research (OpenAI, 2025a) have demonstrated their promising potential, attracting massive interests from both academia and industry (Zhang et al., 2025). The majority of contemporary web agents are architected upon the influential ReAct paradigm (Yao et al., 2023), where an agent iteratively interacts with an environment in a reasoning-action-observation loop. Examples include WebThinker (Li et al., 2025c), WebDancer (Wu et al., 2025), WebSailor (Li et al., 2025b), WebSailor-V2 (Li et al., 2025a), WebShaper (Tao et al., 2025), WebExplorer (Liu et al., 2025) that focus on dataset construction; X-Master (Chai et al., 2025) and BrowseMaster (Pang et al., 2025) that focus on test-time scaling (Ye et al., 2025). However, the append-only context inherent to the ReAct paradigm leads to context saturation on long-horizon tasks, impairing reasoning as critical signals become buried in noise. Our work addresses this vulnerability by empowering AgentFold to proactively sculpt its cognitive workspace, ensuring the context remains focused and efficient.

Context Management. Context management, or context engineering, is an emerging research topic aiming to provide LLM agents with an appropriate and effective context (Mei et al., 2025; Qiao et al., 2025). A significant line of research focuses on External Context Augmentation, which injects relevant knowledge from sources outside the current task trajectory—such as user profiles or past conversations—to provide a richer, more personalized context (Li et al., 2025d; Chhikara et al., 2025; Xu et al., 2025; Yang et al., 2024). Our work, in contrast, pursues Intra-Task Context Curation, which focuses on managing the context generated within the task itself to maintain relevance and efficiency over long horizons. Along this line, MEM1 (Zhou et al., 2025b) and MemAgent (Yu et al., 2025) are two recent attempts that compress the full history at each step. However, these methods employ a rigid, step-wise summarization policy and have been primarily evaluated on simpler, retrieval-focused tasks like HotpotQA (Yang et al., 2018). Unlike these methods, AgentFold introduces a flexible look-back mechanism that avoids rigid, step-wise compression by retrospectively evaluating and selectively folding multi-step interactions at different scales, a capability crucial for complex, long-horizon tasks (Wei et al., 2025; Zhou et al., 2025a).

3AgentFold: Web Agent with Proactive Context Folding
3.1Overview
AgentFold is a novel web agent designed to tackle complex, long-horizon tasks by emulating a key aspect of human cognition: proactive and structured context/memory management. At its core, AgentFold makes two primary designs: first, it defines the agent’s context not as a monolithic log, but as a dynamic cognitive workspace. Second, it empowers the agent to proactively operate upon and sculpt this workspace as an intrinsic part of its reasoning process.

AgentFold’s workspace (i.e., context) is explicitly partitioned into the invariant user question, the curated Multi-Scale State Summaries representing long-term memory, and the high-fidelity Latest Interaction serving as the immediate working memory. Based on this workspace, the agent’s operational process unfolds iteratively. In a typical step, its reasoning yields a multi-part response comprising a folding directive to manage historical state summaries, an explanation of its thought process, and the next action. The folding directive is immediately applied to update the Multi-Scale State Summaries for future steps, while the explanation, the executed action and its resulting observation form the new Latest Interaction for the subsequent cycle. This process repeats until the agent determines it has gathered sufficient information to provide an accurate final answer, with the initial step being a special case that omits the folding directive due to the absence of prior history.

This operational cycle establishes a powerful perceive -> reason -> fold -> act loop, where context curation is an explicit, learned step rather than a passive byproduct. By synergizing a well-defined cognitive workspace with the agent’s autonomy to manipulate it, AgentFold directly resolves the critical trade-off between retaining granular details and preventing context inflation, enabling a more focused and efficient reasoning process for complex, long-horizon challenges.

Refer to caption
Figure 2:Overview of AgentFold at an intermediate step. The two key parts in AgentFold’ context are: Multi-Scale State Summaries (several folded blocks recording previous information) and Latest Interaction (a full record of the latest step). AgentFold responds with four blocks: thinking, folding, explanation, and tool call (which leads to an appended tool response). The folding directive has two operation modes: granular condensation that folds one single step with useful information reserved and deep consolidation that folds several steps with a coarse summary especially when these steps complete a sub-task and the intermediate details are not critical for further task-solving.
3.2AgentFold’s Context: Multi-Scale State Summaries, Latest Interaction
The performance of a web agent is critically dependent on the quality and structure of the context it receives. To this end, we design AgentFold’s context as a dynamic cognitive workspace partitioned into four distinct components (i.e., user question, available tools, multi-scale state summaries, and latest interaction) to enable both strategic long-range planning and precise situational action.

(1) The question serves as an anchor, constantly reminding the agent of its ultimate objective. (2) The list of available tools defines the agent’s capacity for action within its environment. This component provides a detailed schema for each tool—including its name, description, and required parameters—outlining the agent’s entire suite of executable operations. (3) The Multi-Scale State Summaries function as the agent’s curated long-term memory. This component preserves the sequential, logical flow of the trajectory, with past steps recorded at different scales based on their perceived utility for future actions. This multi-scale structure allows critical findings to be retained as distinct, fine-grained summaries, while less critical intermediate steps can be consolidated into coarser, more abstract blocks. Consequently, it retains a coherent historical narrative while minimizing informational noise. (4) The Latest Interaction acts as a high-fidelity working memory. It provides the complete, complete record of the most recent transaction—including the agent’s brief thinking (explanation), the executed tool call, and the resulting observation. This full transparency into the immediate past is crucial for providing the situational awareness needed to make a sound decision, which involves both how to selectively fold this new information and what action to generate next. The entire architecture mirrors how humans leverage a stable goal, consolidated knowledge, and a volatile working memory.

Specifically, the context 
C
t
 provided to the agent at step 
t
 is a triplet:

C
t
=
(
Q
,
T
,
S
t
−
2
,
I
t
−
1
)
(1)
where 
Q
 and 
T
 are the invariant user question and tools, respectively. 
S
t
−
2
 represents the Multi-Scale State Summaries, a dynamically updated sequence of condensed summaries from previous steps. Formally, we represent 
S
t
−
2
 as an ordered sequence of summary blocks:

S
t
=
(
s
x
1
,
y
1
,
s
x
2
,
y
2
,
…
,
s
x
m
,
y
m
)
(2)
where each 
s
x
,
y
 is a textual summary of the contiguous block of steps from 
x
 to 
y
. The step ranges partition the entire history up to the previous step, such that 
x
1
=
1
, 
y
m
=
t
−
2
, and 
x
i
+
1
=
y
i
+
1
 for all 
i
. This notation explicitly captures the multi-scale property: a summary of a single, independent step is denoted as 
s
x
,
x
 (where 
y
=
x
), whereas a summary representing the consolidation of a multi-step process (e.g., verifying a condition over several steps) is denoted as 
s
x
,
y
 (where 
y
>
x
). The third component, 
I
t
−
1
, is the Latest Interaction, a verbose, complete record of the previous step’s full transaction. It is formed by concatenating the explanation, action, and observation from step 
t
−
1
: 
I
t
−
1
=
(
e
t
−
1
,
a
t
−
1
,
o
t
−
1
)
. For the initial step (
t
=
1
), the context is initialized as 
C
1
=
(
Q
,
T
,
∅
,
∅
)
, containing only the user’s question; while for step 2, the context is set as 
C
2
=
(
Q
,
T
,
∅
,
I
1
)
, containing the user question and latest interaction.

This structured context design offers the best of both worlds. The Latest Interaction provides the raw, granular detail necessary for the agent to make informed, short-term decisions without any loss of information. Simultaneously, the Multi-Scale State Summaries offer a noise-free, abstracted overview of the mission so far, preventing the agent from getting lost in irrelevant details and enabling coherent long-term reasoning. This structure directly mitigates the trade-off between context comprehensiveness and conciseness that hinges contemporary web agents.

3.3AgentFold’s Response: Thinking, Folding, Explanation, Action
Complementing its structured cognitive workspace, AgentFold’s response is not a monolithic command but a multi-faceted output that reflects its dual role as both a situational problem-solver and a strategic context manager. At each step, the agent generates a single, coherent block of text that is parsed into three components, each designed to operate on its context: a directive to fold its long-term memory, an explanation to articulate its motivation behind the following action, and an action to propel the task forward. This design integrates context management as a core, learnable component of the agent’s reasoning process, rather than treating it as a passive byproduct.

Specifically, at each step 
t
, AgentFold generates a response 
R
t
 based on the context 
C
t
 and model 
θ
. This response is a single, coherent block of text designed to be parsed into a quadruplet:

R
t
=
AgentFold
​
(
C
t
;
θ
)
→
(
t
​
h
t
,
f
t
,
e
t
,
a
t
)
(3)
Here, 
t
​
h
t
 is the thinking process, a detailed chain-of-thought monologue where the agent analyzes its context (
C
t
) and weighs options for both context folding and the subsequent action. From this internal deliberation, the other three structured components are derived. (1) The folding directive (
f
t
) is the agent’s explicit command for sculpting its Multi-Scale State Summaries 
S
t
−
2
. It takes the form of a JSON object: 
f
t
=
{
‘
‘
𝚛𝚊𝚗𝚐𝚎
"
:
[
k,t-1
]
,
‘
‘
𝚜𝚞𝚖𝚖𝚊𝚛𝚢
"
:
‘
‘
σ
t
"
}
, where 
k
 is the starting ID for folding and 
σ
t
 is the replacement summary text that can be proactively determined by AgentFold itself. This single format supports two modes of context management that operate at different scales:

• Granular Condensation (
k
=
t
−
1
): This operation folds only the Latest Interaction into a new, fine-grained summary. It is used for incremental steps, preserving the highest resolution of the historical trajectory by converting a single verbose record into a compact summary block (e.g., ‘[Compressed Step 5] Found a new candidate XYZ that needs further exploration.’).
• Deep Consolidation (
k
<
t
−
1
): This operation performs a change of scale by fusing the Latest Interaction with a chain of prior summaries into a single, coarse-grained summary. This is powerful for abstracting away noisy, intermediate steps once a sub-task is complete. For instance, an agent might spend multiple steps verifying a single fact, navigating through irrelevant websites or encountering failed tool calls. Deep consolidation allows the agent to retract this entire verbose sequence and replace it with a single, conclusive summary (e.g., ‘[Compressed Step 5 to 9] Confirmed that XYZ does not fit all criteria after checking several sources]’).
This directive transforms Multi-Scale State Summaries 
S
t
−
2
 into 
S
t
−
1
 by retracting all summary blocks whose steps fall within the range 
[
k
,
t
−
1
]
 and replacing them with a single new summary block, 
s
k
,
t
−
1
=
σ
t
. (2) The explanation (
e
t
) is a concise summary of the key insights from the thinking process, articulating the motivation for the chosen action. (3) Finally, 
a
t
 is the agent’s chosen external action, which is either a tool call with specified tool name and tool arguments, or the final answer if the agent deems that no further interaction is required. When another tool call is invoked, the tool will be executed to obtain the observation 
o
t
 from the environments. Finally, the question 
Q
, tools 
T
, the new Multi-Scale State Summaries 
S
t
−
1
 and Latest Interaction 
I
t
=
(
e
t
,
a
t
,
o
t
)
 constitute the AgentFold’s context 
C
t
+
1
=
(
Q
,
T
,
S
t
−
1
,
I
t
)
 for the next step 
t
+
1
.

This structured response architecture engenders a powerful cognitive symbiosis between the agent’s two core deliberations: planning the next action and curating its own context. (1) The explicit requirement to formulate a folding directive compels the agent to critically evaluate its trajectory and distill the most salient information from its historical context. This act of reflection inherently sharpens its understanding of the current state, leading to a more informed and effective subsequent action. (2) Conversely, the process of planning a new action necessitates a purposeful interrogation of its recent history to identify pivotal clues. This very process of determining what is immediately relevant provides a perfect, real-time signal for what is worth preserving in a folded summary. This tight coupling of acting and reflecting ensures that AgentFold’s behavior is both purposeful and efficient, creating a self-regulating loop that simultaneously enhances the quality of its actions and the coherence of its context memory.

3.4AgentFold’s Training: Data Trajectory Collection
Training AgentFold requires a dataset that does not yet exist: trajectories that demonstrate a sophisticated interplay of situational action and strategic context curation. To this end, we develop Fold-Generator, a specialized data collection pipeline built upon powerful open-source Large Language Models (LLMs) to generate the necessary trajectory training data. To ensure a fair and direct comparison with prior work, we utilize the same question set as the recent WebSailor work (Li et al., 2025a). We find that even the most advanced LLMs cannot reliably produce AgentFold’s accurate, structured, multi-part responses through prompt engineering alone. To relieve the effects of this, we leverage a rejection sampling mechanism, discarding any generated step that fails to strictly adhere required formats, or any trajectory that contains too many environmental errors. This ensures every data point in our collection is a clear example of the desired reasoning process.

Specifically, the output of the Fold-Generator is a collection of high-quality interaction pairs, 
{
(
C
t
,
R
t
∗
)
}
N
, where each 
C
t
 is the structured context, 
R
t
∗
 is the validated, gold-standard response, and 
N
 is the total number of interaction steps across all questions. This curated dataset is then used for conducting conventional Supervised Fine-Tuning (SFT) on open-source LLMs. The training objective is to distill the complex, multi-step, validated reasoning of our pipeline into a single, efficient forward pass, thereby teaching the model to produce the entire structured output intrinsically.

This training methodology is not merely an implementation choice but a necessity that yields critical advantages. Primarily, it transforms the agent’s ability to ‘fold‘ from a fragile, prompt-dependent instruction into a robust, internalized skill. Furthermore, the SFT process effectively distills the computationally intensive ‘generate-and-filter‘ strategy into the weights of the final AgentFold model. This results in a specialized agent that is not only highly capable but also significantly more efficient at inference time than the general-purpose models used for data collection. Finally, by building this entire pipeline on open-source models, we maintain full transparency and control over the data and training process, enabling detailed inspection and future iteration.

3.5Discussions
AgentFold’s design offers a novel approach to context management, resolving the trade-off between the append-only history of ReAct, which leads to context saturation, and uniform full-history summarization, which risks irreversible information loss. The primary advantage lies in the agent’s ability to adapt its folding strategy. It can employ Granular Condensation to preserve a potentially vital, fine-grained detail, protecting it from the indiscriminate compression of a full-history summarizer. Conversely, it can use Deep Consolidation to prune an entire concluded sub-investigation, combating the noise accumulation found in ReAct. Crucially, the ability to delay consolidation until a sub-task’s outcome is clear allows for more informed and less short-sighted curation decisions.

This flexibility is critical for maintaining long-term informational integrity. To illustrate, if we assume a modest 1% chance of a key detail being lost each time the full history is re-summarized, the probability of a finding from step 1 surviving until step 100 reduces to just 
≈
36.6
%
​
(
0.99
𝟏𝟎𝟎
)
. This risk is exacerbated in extremely long-horizon tasks; after 500 steps, for instance, the survival probability for the same detail collapses to only 0.66% (
0.99
𝟓𝟎𝟎
). AgentFold’s Granular Condensation directly mitigates this compounding risk by preserving the detail in a distinct block, exempting it from unnecessary reprocessing. In parallel, ReAct’s append-only policy faces the deterministic certainty of context saturation, where after 100 steps the context is burdened by the full verbosity of every past interaction. AgentFold’s Deep Consolidation addresses this by surgically pruning such irrelevant traces, ensuring the context remains both focused and computationally manageable.

This represents a conceptual leap from agents with static, predefined context policies to those as self-aware knowledge managers. By integrating context curation as a learnable, core action, AgentFold learns sophisticated, task-specific strategies for what to remember, what to abstract, and what to discard. This ability to actively shape its own informational workspace is the key to its enhanced robustness and efficiency, enabling it to dynamically balance the need for granular detail with a coherent long-term plan on complex, long-horizon challenges.

4Experiments
Implementation. We train our AgentFold based on open-source LLM Qwen3-30B-A3B-Instruct-2507 (Yang et al., 2025) with 30B parameters in total and 3B activated during prediction. We set the max tool call number as 100, any trajectory beyond this number will be forcibly terminated.

Benchmarks. We consider 3 information-seeking benchmarks including BrowseComp (Wei et al., 2025), BrowseComp-ZH (Zhou et al., 2025a), and WideSearch-en (the most detailed metric: Item-F1) (Wong et al., 2025); and 1 general benchmark: GAIA (text-only subset) (Mialon et al., 2023). Note that BrowseComp and BrowseComp-ZH mainly evaluates the agent’s capability in locating hard-to-find information; WideSearch emphasizes on capability of broad search; and GAIA is for evaluating general capabilities of AI agents. For benchmarks with less than 200 samples, we report the averaged results on 3 trials.

Baselines. We comprehensively compare our AgentFold-30B-A3B with representative open-source agents including WebThinker (Li et al., 2025c), WebDancer (Wu et al., 2025), WebSailor (Li et al., 2025b), ASearcher (Gao et al., 2025), MiroThinker (MiroMind AI Team, 2025), WebExplorer (Liu et al., 2025), DeepDive (Shi et al., 2025), DeepDiver-V2 (OpenPangu Team, 2025), Kimi-K2-Instruct (Team et al., 2025), GLM-4.5 Zeng et al. (2025), and DeepSeek-V3.1 (DeepSeek Team, 2025). We also report performances of several proprietary agents for reference, including Claude-4-Sonnet/Opus (anthropic, 2025), OpenAI-o4-mini/o3 (OpenAI, 2025b) and OpenAI Deep Research (OpenAI, 2025a). Some results are taken from corresponding papers or leaderboards.

4.1Results and Analysis
Main results, presented in Table 1, demonstrate that AgentFold-30B-A3B establishes a new state of the art for open-source agents and is highly competitive with leading proprietary systems. Notably, it solidifies its dominance in the open-source landscape by outperforming models up to 20 times its size, scoring 36.2% on BrowseComp against the 671B DeepSeek-V3.1’s 30.0%. Furthermore, AgentFold proves its capability at the highest level by achieving the best overall score of 62.1% on WideSearch, surpassing all proprietary agents including OpenAI-o3 and Claude-4-Sonnet. These results underscore the profound impact of our architectural innovations, showcasing how effective context management can bridge the performance gap with dramatically larger models.

Table 1:Main results. AgentFold-30B-A3B achieves remarkable performance, surpassing open-source agents with much larger model size such as DeepSeek-V3.1-671B-A37B and matching proprietary agents such as OpenAI-o4-mini, indicating the potential of this new paradigm.
Agent	BrowseComp	BrowseComp-ZH	WideSearch	GAIA
Proprietary Agents
Claude-4-Sonnet	14.7	22.5	62.0	68.3
Claude-4-Opus (anthropic, 2025) 	18.8	37.4	-	-
OpenAI-o4-mini (OpenAI, 2025b) 	28.3	44.3	-	-
OpenAI-o3 (OpenAI, 2025b) 	49.7	58.1	60.0	70.5
OpenAI Deep Research (OpenAI, 2025a) 	51.5	42.9	-	67.4
Open-Source Agents
WebThinker-32B Li et al. (2025c) 	2.8	7.3	-	48.5
WebDancer-32B (Wu et al., 2025) 	3.8	18.0	-	51.5
WebSailor-32B (Li et al., 2025b) 	10.5	25.5	-	53.2
WebSailor-72B (Li et al., 2025b) 	12.0	30.1	-	55.4
ASearcher-Web-32B (Gao et al., 2025) 	5.2	15.6	-	52.8
MiroThinker-32B-DPO-v0.2 (MiroMind AI Team, 2025) 	13.0	17.0	-	64.1
WebExplorer-8B (Liu et al., 2025) 	15.7	32.0	-	50.0
DeepDive-32B (Lu et al., 2025) 	14.8	25.6	-	-
DeepDiver-V2-38B (OpenPangu Team, 2025) 	13.4	34.6	-	-
Kimi-K2-Instruct-1T (Team et al., 2025) 	14.1	28.8	59.9	57.3
GLM-4.5-355B-A32B (Zeng et al., 2025) 	26.4	37.5	-	66.0
DeepSeek-V3.1-671B-A37B (DeepSeek Team, 2025) 	30.0	49.2	-	63.1
AgentFold-30B-A3B (Ours)	36.2	47.3	62.1	67.0
 
Refer to caption
(a)Growth curve of AgentFold’s context
Refer to caption
(b)Number of blocks in AgentFold’s context
Figure 3:Analysis of AgentFold’s context on trajectories sampled from BrowseComp. (a) AgentFold’s context length grows at a remarkably slow, sub-linear rate, less than doubling from approximately 3.5k to 7k over 100 turns. As our model’s max context is 128k, this indicates a promising potential for AgentFold for tackling complex and long-horizon tasks. (b) Our Deep consolidation operation in AgentFold merges multiple past steps into a single summary, thereby maintaining a significantly more structural and concise context compared to the popular ReAct.
Dynamics of AgentFold’s context: token count. To empirically validate AgentFold’s context management, we analyze 200 trajectories from the BrowseComp benchmark (Figure 3(a)). We plot the number of surviving trajectories at each turn (
|
𝒯
t
|
, grey bars) alongside the average context token count (
A
t
, blue curve) for those same trajectories. Specifically, 
A
t
 is formally defined as: 
A
t
=
1
|
𝒯
t
|
​
∑
j
∈
𝒯
t
TokenCount
​
(
C
j
,
t
)
 where 
𝒯
t
 is the set of surviving trajectories that are consisted of more than 
t
 turns, and 
C
j
,
t
 is the context of trajectory 
j
 at turn 
t
.

The figure reveals that AgentFold maintains an exceptionally concise context. The average token count grows at a remarkably slow, sub-linear rate, less than doubling from approximately 3.5k to 7k over 100 turns, proving the efficacy of the ‘fold’ operation in preventing context inflation.

When observing the survival curve, we notice that over 20% of tasks being forcibly terminated at our experimental limit of 100 turns, which are typically marked as failure. Crucially, at this termination point, the agent’s context is only 
≈
7k tokens—a minor fraction of the underlying model’s 128k capacity. This vast remaining capacity points to two promising conclusions. (1) First, it suggests that simply scaling the number of allowed interactions could unlock higher success rates. (2) Second, and more broadly, it demonstrates AgentFold’s significant potential for tackling extremely complex and long-horizon problems. We provide a conceptual verification in the following Figure 4 but defer detailed explorations to future work due to time constraints.

Dynamics of AgentFold’s context: block count. To analyze the structural complexity of the context, we measure the number of discrete ‘blocks’ in the agent’s workspace at each turn. A block is defined as any single entry in the Multi-Scale State Summaries (e.g., ‘[Compressed Step 52 to 67]’ is one block) plus the one Latest Interaction. For an append-only method like ReAct, this count necessarily increases linearly with each turn (reference line in Figure 3(b)). The analysis of AgentFold’s block count reveals two key conclusions. (1) Sub-linear growth and structural simplicity. In stark contrast to the linear explosion of ReAct, AgentFold’s block count grows at a slow, sub-linear rate. This efficiency is driven by the Deep Consolidation operation, which merges multiple past steps into a single summary, thereby maintaining a structurally simple and cognitively manageable context. (2) Compounding efficiency over time. The growing divergence between the two curves highlights the compounding advantage of proactive curation. While ReAct’s append-only policy leads to runaway structural complexity over long horizons, AgentFold’s consolidation ensures the context remains controlled, so its efficiency advantage over ReAct grows larger on longer tasks.

Context comparison between AgentFold and ReAct. To provide a more direct and intuitive comparison, we plot the average context length (in tokens) of AgentFold against a standard ReAct baseline across the same set of trajectories. As illustrated on the right of Figure 1, the contrast is stark. The ReAct agent’s context exhibits an uncontrolled, near-linear growth, accumulating a massive token count as the task progresses. In contrast, AgentFold’s context size remains remarkably flat and controlled due to its proactive folding mechanism.

By the 100th turn, this architectural difference results in a dramatic quantitative advantage: AgentFold’s context is, on average, over 84k tokens (92%) smaller than ReAct’s. This token reduction also has profound implications for computational resource requirements, translating to an estimated memory saving of nearly 7GB per inference instance at this trajectory length. This analysis demonstrates not only the conceptual benefits of our approach but also its immense practical value in making long-horizon agents more efficient, scalable, and cost-effective.

Refer to caption
Figure 4:Scaling properties of interaction turns (tool calls). This demonstrates the profound potential of AgentFold to tirelessly and robustly work for hundreds of steps for humans.
Scaling Properties of Interaction Turns. Building on our finding of its compact context in Figure 3(a), we test AgentFold’s performance when scaling the number of interaction turns, a primary bottleneck for conventional agents. As shown in Figure 4, we evaluate on BrowseComp with a turn limit up to 256, comparing our 30B model against a much larger 355B GLM-4.5 baseline. The results show two clear advantages. (1) First, our smaller model consistently outperforms the 355B baseline at all comparable turn limits. (2) Second, the GLM-4.5 agent’s performance saturates and fails beyond 64 turns as its append-only context fills, while AgentFold’s accuracy continues to improve steadily up to 256 turns, showing promising scaling property.

To further probe these limits, we conduct an extended experiment, increasing the maximum number of turns to 500, with the context length dynamics reported in Figure 1. The results reveal that the context mostly remains below 20k tokens and, notably, does not grow monotonically. This behavior is a direct result of AgentFold’s ability to recognize and recover from dead ends. When a lengthy line of inquiry proves unsuccessful, the agent can perform a deep consolidation of the entire failed sub-trajectory. This act of abstracting away a long, irrelevant history while pivoting to a new strategy often resets the context to a more compact state, showcasing a sophisticated, self-correcting form of context management.

This experiment confirms that AgentFold’s proactive context management is the key to unlocking long-horizon task-solving. It demonstrates the profound potential for agents to engage in truly extended interactions—potentially lasting for hundreds of steps—to perform the kind of broad and deep web exploration required for complex research and analysis tasks that remain far beyond the reach of conventional agent architectures.

Refer to caption
Figure 5:Case study for illustration of AgentFold. See detailed content in Table LABEL:tab:case1_traj, Figure 6 and 7. After a series of failure attempts happened (steps 6 to 16), AgentFold notices that this direction might be a dead end, folds these intermediate steps into one conclusion, plans to switch to other search directions, and decides the new search queries.
Case study. To directly illustrate AgentFold’s operational intelligence, we provide a case study in Figure 5 (with more in Appendix A.1). The figure captures the agent at step 17 of a complex task, where its context already showcases its multi-scale structure, comprising both fine-grained, single-step summaries (e.g., [Compressed Step 5]) and previously consolidated blocks (e.g., [Compressed Step 6 to 8]). The figure showcases a critical moment of reflection and re-planning. Recognizing a long and unsuccessful series of attempts (from step 6 to 16) as a dead end, AgentFold executes a decisive, strategic move. First, it performs a Deep Consolidation, folding the entire 11-step failed sequence into a single, conclusive summary. This operation distills the valuable lesson from the failures—that this approach is unworkable—while pruning the noisy and now-irrelevant procedural details from its context. Informed by this newly consolidated insight, the agent then dynamically plans (in the motivation block, equals to explanation) to shift towards a new line of investigation, which is immediately reflected in its subsequent tool call. This example powerfully demonstrates AgentFold’s ability to reason about its own trajectory, learn from extended failures, and strategically re-plan by actively curating its cognitive workspace.

5Conclusions
This paper introduces AgentFold, a novel agent paradigm that resolves the fundamental trade-off between context saturation in append-only agents (e.g., ReAct) and irreversible information loss from uniform summarization. We move beyond these static policies by empowering the agent to act as a self-aware knowledge manager, equipped with a proactive ‘fold‘ operation to dynamically sculpt its context at multiple scales. This mechanism allows the agent to preserve fine-grained details via Granular Condensation while abstracting away irrelevant history with Deep Consolidation. Our experiments validate the power of this approach: the AgentFold-30B-A3B model establishes a new state of the art for open-source agents, outperforming models over 20 times its size like DeepSeek-V3.1-671B and proving highly competitive against leading proprietary agents such as OpenAI’s o4-mini. Furthermore, its exceptional context efficiency enables truly long-horizon problem-solving by supporting hundreds of interaction steps within a manageable context.

What’s next. In this work, we prioritize demonstrating the potential of the AgentFold paradigm, thus employing a straightforward SFT approach without extensive optimization. The clear next step is to leverage reinforcement learning (RL) to enable the agent to autonomously discover optimal and potentially non-obvious folding policies by directly optimizing for task success.

References
anthropic (2025)
anthropic.Introducing claude 4, 2025.URL https://www.anthropic.com/news/claude-4.
Chai et al. (2025)
Jingyi Chai, Shuo Tang, Rui Ye, Yuwen Du, Xinyu Zhu, Mengcheng Zhou, Yanfeng Wang, Yuzhi Zhang, Linfeng Zhang, Siheng Chen, et al.Scimaster: Towards general-purpose scientific ai agents, part i. x-master as foundation: Can we lead on humanity’s last exam?arXiv preprint arXiv:2507.05241, 2025.
Chhikara et al. (2025)
Prateek Chhikara, Dev Khant, Saket Aryan, Taranjeet Singh, and Deshraj Yadav.Mem0: Building production-ready ai agents with scalable long-term memory.arXiv preprint arXiv:2504.19413, 2025.
Comanici et al. (2025)
Gheorghe Comanici, Eric Bieber, Mike Schaekermann, Ice Pasupat, Noveen Sachdeva, Inderjit Dhillon, Marcel Blistein, Ori Ram, Dan Zhang, Evan Rosen, et al.Gemini 2.5: Pushing the frontier with advanced reasoning, multimodality, long context, and next generation agentic capabilities.arXiv preprint arXiv:2507.06261, 2025.
DeepSeek Team (2025)
DeepSeek Team.Introducing deepseek-v3.1: our first step toward the agent era!, 2025.URL https://api-docs.deepseek.com/news/news250821.
Gao et al. (2025)
Jiaxuan Gao, Wei Fu, Minyang Xie, Shusheng Xu, Chuyi He, Zhiyu Mei, Banghua Zhu, and Yi Wu.Beyond ten turns: Unlocking long-horizon agentic search with large-scale asynchronous rl.arXiv preprint arXiv:2508.07976, 2025.
Given et al. (2023)
Lisa M Given, Donald O Case, and Rebekah Willson.Looking for information: Examining research on how people engage with information.Emerald Publishing Limited, 2023.
Li et al. (2025a)
Kuan Li, Zhongwang Zhang, Huifeng Yin, Rui Ye, Yida Zhao, Liwen Zhang, Litu Ou, Dingchu Zhang, Xixi Wu, Jialong Wu, et al.Websailor-v2: Bridging the chasm to proprietary agents via synthetic data and scalable reinforcement learning.arXiv preprint arXiv:2509.13305, 2025a.
Li et al. (2025b)
Kuan Li, Zhongwang Zhang, Huifeng Yin, Liwen Zhang, Litu Ou, Jialong Wu, Wenbiao Yin, Baixuan Li, Zhengwei Tao, Xinyu Wang, et al.Websailor: Navigating super-human reasoning for web agent.arXiv preprint arXiv:2507.02592, 2025b.
Li et al. (2025c)
Xiaoxi Li, Jiajie Jin, Guanting Dong, Hongjin Qian, Yutao Zhu, Yongkang Wu, Ji-Rong Wen, and Zhicheng Dou.Webthinker: Empowering large reasoning models with deep research capability.arXiv preprint arXiv:2504.21776, 2025c.
Li et al. (2025d)
Zhiyu Li, Shichao Song, Hanyu Wang, Simin Niu, Ding Chen, Jiawei Yang, Chenyang Xi, Huayi Lai, Jihao Zhao, Yezhaohui Wang, et al.Memos: An operating system for memory-augmented generation (mag) in large language models.arXiv preprint arXiv:2505.22101, 2025d.
Liu et al. (2025)
Junteng Liu, Yunji Li, Chi Zhang, Jingyang Li, Aili Chen, Ke Ji, Weiyu Cheng, Zijia Wu, Chengyu Du, Qidi Xu, et al.Webexplorer: Explore and evolve for training long-horizon web agents.arXiv preprint arXiv:2509.06501, 2025.
Lu et al. (2025)
Rui Lu, Zhenyu Hou, Zihan Wang, Hanchen Zhang, Xiao Liu, Yujiang Li, Shi Feng, Jie Tang, and Yuxiao Dong.Deepdive: Advancing deep search agents with knowledge graphs and multi-turn rl.arXiv preprint arXiv:2509.10446, 2025.
Marchionini (1995)
Gary Marchionini.Information seeking in electronic environments.Number 9. Cambridge university press, 1995.
Mei et al. (2025)
Lingrui Mei, Jiayu Yao, Yuyao Ge, Yiwei Wang, Baolong Bi, Yujun Cai, Jiazhi Liu, Mingyu Li, Zhong-Zhi Li, Duzhen Zhang, et al.A survey of context engineering for large language models.arXiv preprint arXiv:2507.13334, 2025.
Mialon et al. (2023)
Grégoire Mialon, Clémentine Fourrier, Thomas Wolf, Yann LeCun, and Thomas Scialom.Gaia: a benchmark for general ai assistants.In The Twelfth International Conference on Learning Representations, 2023.
Miller (1956)
George A Miller.The magical number seven, plus or minus two: Some limits on our capacity for processing information.Psychological review, 63(2):81, 1956.
MiroMind AI Team (2025)
MiroMind AI Team.Mirothinker: An open-source agentic model series trained for deep research and complex, long-horizon problem solving, 2025.URL https://github.com/MiroMindAI/MiroThinker.
Newell et al. (1972)
Allen Newell, Herbert Alexander Simon, et al.Human problem solving, volume 104.Prentice-hall Englewood Cliffs, NJ, 1972.
OpenAI (2025a)
OpenAI.Deep research system card, 2025a.URL https://cdn.openai.com/deep-research-system-card.pdf.
OpenAI (2025b)
OpenAI.Introducing openai o3 and o4-mini, 2025b.URL https://openai.com/index/introducing-o3-and-o4-mini/.
OpenPangu Team (2025)
OpenPangu Team.Openpangu deepdiver-v2: Multi-agent learning for deep information seeking, 2025.URL https://ai.gitcode.com/ascend-tribe/openPangu-Embedded-7B-DeepDiver.
Pang et al. (2025)
Xianghe Pang, Shuo Tang, Rui Ye, Yuwen Du, Yaxin Du, and Siheng Chen.Browsemaster: Towards scalable web browsing via tool-augmented programmatic agent pair.arXiv preprint arXiv:2508.09129, 2025.
Qiao et al. (2025)
Zile Qiao, Guoxin Chen, Xuanzhong Chen, Donglei Yu, Wenbiao Yin, Xinyu Wang, Zhen Zhang, Baixuan Li, Huifeng Yin, Kuan Li, et al.Webresearcher: Unleashing unbounded reasoning capability in long-horizon agents.arXiv preprint arXiv:2509.13309, 2025.
Shi et al. (2025)
Wenxuan Shi, Haochen Tan, Chuqiao Kuang, Xiaoguang Li, Xiaozhe Ren, Chen Zhang, Hanting Chen, Yasheng Wang, Lifeng Shang, Fisher Yu, et al.Pangu deepdiver: Adaptive search intensity scaling via open-web reinforcement learning.arXiv preprint arXiv:2505.24332, 2025.
Tao et al. (2025)
Zhengwei Tao, Jialong Wu, Wenbiao Yin, Junkai Zhang, Baixuan Li, Haiyang Shen, Kuan Li, Liwen Zhang, Xinyu Wang, Yong Jiang, et al.Webshaper: Agentically data synthesizing via information-seeking formalization.arXiv preprint arXiv:2507.15061, 2025.
Team et al. (2025)
Kimi Team, Yifan Bai, Yiping Bao, Guanduo Chen, Jiahao Chen, Ningxin Chen, Ruijue Chen, Yanru Chen, Yuankun Chen, Yutian Chen, et al.Kimi k2: Open agentic intelligence.arXiv preprint arXiv:2507.20534, 2025.
Wang et al. (2025)
Haoming Wang, Haoyang Zou, Huatong Song, Jiazhan Feng, Junjie Fang, Junting Lu, Longxiang Liu, Qinyu Luo, Shihao Liang, Shijue Huang, Wanjun Zhong, Yining Ye, Yujia Qin, Yuwen Xiong, Yuxin Song, Zhiyong Wu, Bo Li, Chen Dun, Chong Liu, Fuxing Leng, Hanbin Wang, Hao Yu, Haobin Chen, Hongyi Guo, Jing Su, Jingjia Huang, Kai Shen, Kaiyu Shi, Lin Yan, Peiyao Zhao, Pengfei Liu, Qinghao Ye, Renjie Zheng, Wayne Xin Zhao, Wen Heng, Wenhao Huang, Wenqian Wang, Xiaobo Qin, Yi Lin, Youbin Wu, Zehui Chen, Zihao Wang, Baoquan Zhong, Xinchun Zhang, Xujing Li, Yuanfan Li, Zhongkai Zhao, Chengquan Jiang, Faming Wu, Haotian Zhou, Jinlin Pang, Li Han, Qianli Ma, Siyao Liu, Songhua Cai, Wenqi Fu, Xin Liu, Zhi Zhang, Bo Zhou, Guoliang Li, Jiajun Shi, Jiale Yang, Jie Tang, Li Li, Taoran Lu, Woyu Lin, Xiaokang Tong, Xinyao Li, Yichi Zhang, Yu Miao, Zhengxuan Jiang, Zili Li, Ziyuan Zhao, Chenxin Li, Dehua Ma, Feng Lin, Ge Zhang, Haihua Yang, Hangyu Guo, Hongda Zhu, Jiaheng Liu, Junda Du, Kai Cai, Kuanye Li, Lichen Yuan, Meilan Han, Minchao Wang, Shuyue Guo, Tianhao Cheng, Xiaobo Ma, Xiaojun Xiao, Xiaolong Huang, Xinjie Chen, Yidi Du, Yilin Chen, Yiwen Wang, Zhaojian Li, Zhenzhu Yang, Zhiyuan Zeng, Chaolin Jin, Chen Li, Hao Chen, Haoli Chen, Jian Chen, Qinghao Zhao, and Guang Shi.Ui-tars-2 technical report: Advancing gui agent with multi-turn reinforcement learning, 2025.
Wei et al. (2025)
Jason Wei, Zhiqing Sun, Spencer Papay, Scott McKinney, Jeffrey Han, Isa Fulford, Hyung Won Chung, Alex Tachard Passos, William Fedus, and Amelia Glaese.Browsecomp: A simple yet challenging benchmark for browsing agents.arXiv preprint arXiv:2504.12516, 2025.
Wong et al. (2025)
Ryan Wong, Jiawei Wang, Junjie Zhao, Li Chen, Yan Gao, Long Zhang, Xuan Zhou, Zuo Wang, Kai Xiang, Ge Zhang, et al.Widesearch: Benchmarking agentic broad info-seeking.arXiv preprint arXiv:2508.07999, 2025.
Wu et al. (2025)
Jialong Wu, Baixuan Li, Runnan Fang, Wenbiao Yin, Liwen Zhang, Zhengwei Tao, Dingchu Zhang, Zekun Xi, Yong Jiang, Pengjun Xie, et al.Webdancer: Towards autonomous information seeking agency.arXiv preprint arXiv:2505.22648, 2025.
Xu et al. (2025)
Wujiang Xu, Kai Mei, Hang Gao, Juntao Tan, Zujie Liang, and Yongfeng Zhang.A-mem: Agentic memory for llm agents.arXiv preprint arXiv:2502.12110, 2025.
Yang et al. (2025)
An Yang, Anfeng Li, Baosong Yang, Beichen Zhang, Binyuan Hui, Bo Zheng, Bowen Yu, Chang Gao, Chengen Huang, Chenxu Lv, et al.Qwen3 technical report.arXiv preprint arXiv:2505.09388, 2025.
Yang et al. (2024)
Hongkang Yang, Zehao Lin, Wenjin Wang, Hao Wu, Zhiyu Li, Bo Tang, Wenqiang Wei, Jinbo Wang, Zeyun Tang, Shichao Song, et al.Memory3: Language modeling with explicit memory.arXiv preprint arXiv:2407.01178, 2024.
Yang et al. (2018)
Zhilin Yang, Peng Qi, Saizheng Zhang, Yoshua Bengio, William Cohen, Ruslan Salakhutdinov, and Christopher D Manning.Hotpotqa: A dataset for diverse, explainable multi-hop question answering.In Proceedings of the 2018 Conference on Empirical Methods in Natural Language Processing, pp. 2369–2380, 2018.
Yao et al. (2023)
Shunyu Yao, Jeffrey Zhao, Dian Yu, Nan Du, Izhak Shafran, Karthik Narasimhan, and Yuan Cao.React: Synergizing reasoning and acting in language models.In International Conference on Learning Representations (ICLR), 2023.
Ye et al. (2025)
Rui Ye, Shuo Tang, Rui Ge, Yaxin Du, Zhenfei Yin, Siheng Chen, and Jing Shao.Mas-gpt: Training llms to build llm-based multi-agent systems.In Forty-second International Conference on Machine Learning, 2025.
Yu et al. (2025)
Hongli Yu, Tinghong Chen, Jiangtao Feng, Jiangjie Chen, Weinan Dai, Qiying Yu, Ya-Qin Zhang, Wei-Ying Ma, Jingjing Liu, Mingxuan Wang, et al.Memagent: Reshaping long-context llm with multi-conv rl-based memory agent.arXiv preprint arXiv:2507.02259, 2025.
Zeng et al. (2025)
Aohan Zeng, Xin Lv, Qinkai Zheng, Zhenyu Hou, Bin Chen, Chengxing Xie, Cunxiang Wang, Da Yin, Hao Zeng, Jiajie Zhang, et al.Glm-4.5: Agentic, reasoning, and coding (arc) foundation models.arXiv preprint arXiv:2508.06471, 2025.
Zhang et al. (2025)
Guibin Zhang, Hejia Geng, Xiaohang Yu, Zhenfei Yin, Zaibin Zhang, Zelin Tan, Heng Zhou, Zhongzhi Li, Xiangyuan Xue, Yijiang Li, et al.The landscape of agentic reinforcement learning for llms: A survey.arXiv preprint arXiv:2509.02547, 2025.
Zhou et al. (2025a)
Peilin Zhou, Bruce Leon, Xiang Ying, Can Zhang, Yifan Shao, Qichen Ye, Dading Chong, Zhiling Jin, Chenxuan Xie, Meng Cao, et al.Browsecomp-zh: Benchmarking web browsing ability of large language models in chinese.arXiv preprint arXiv:2504.19314, 2025a.
Zhou et al. (2025b)
Zijian Zhou, Ao Qu, Zhaoxuan Wu, Sunghwan Kim, Alok Prakash, Daniela Rus, Jinhua Zhao, Bryan Kian Hsiang Low, and Paul Pu Liang.Mem1: Learning to synergize memory and reasoning for efficient long-horizon agents.arXiv preprint arXiv:2506.15841, 2025b.
Appendix AAppendix
A.1Case Study
We provide two cases here. See case 1 in Table LABEL:tab:case1_traj, Figure 6, and 7. See case 2 in Table LABEL:tab:case2_traj, Figure 8, and 9.

Table 2:Case Study 1
Turn ID	
Context
Turn 1	
Turn 2	
[Step 0]
Turn 3	
[Compressed Step 0], [Step 1]
Turn 4	
[Compressed Step 0], [Compressed Step 1], [Step 2]
Turn 5	
[Compressed Step 0], [Compressed Step 1 to 2], [Step 3]
Turn 6	
[Compressed Step 0], [Compressed Step 1 to 2], [Compressed Step 3], [Step 4]
Turn 7	
[Compressed Step 0], [Compressed Step 1 to 2], [Compressed Step 3], [Compressed Step 4], [Step 5]
Turn 8	
[Compressed Step 0], [Compressed Step 1 to 2], [Compressed Step 3], [Compressed Step 4], [Compressed Step 5], [Step 6]
Turn 9	
[Compressed Step 0], [Compressed Step 1 to 2], [Compressed Step 3], [Compressed Step 4], [Compressed Step 5], [Compressed Step 6], [Step 7]
Turn 10	
[Compressed Step 0], [Compressed Step 1 to 2], [Compressed Step 3], [Compressed Step 4], [Compressed Step 5], [Compressed Step 6], [Compressed Step 7], [Step 8]
Turn 11	
[Compressed Step 0], [Compressed Step 1 to 2], [Compressed Step 3], [Compressed Step 4], [Compressed Step 5], [Compressed Step 6 to 8], [Step 9]
Turn 12	
[Compressed Step 0], [Compressed Step 1 to 2], [Compressed Step 3], [Compressed Step 4], [Compressed Step 5], [Compressed Step 6 to 8], [Compressed Step 9], [Step 10]
Turn 13	
[Compressed Step 0], [Compressed Step 1 to 2], [Compressed Step 3], [Compressed Step 4], [Compressed Step 5], [Compressed Step 6 to 8], [Compressed Step 9], [Compressed Step 10], [Step 11]
Turn 14	
[Compressed Step 0], [Compressed Step 1 to 2], [Compressed Step 3], [Compressed Step 4], [Compressed Step 5], [Compressed Step 6 to 8], [Compressed Step 9], [Compressed Step 10], [Compressed Step 11], [Step 12]
Turn 15	
[Compressed Step 0], [Compressed Step 1 to 2], [Compressed Step 3], [Compressed Step 4], [Compressed Step 5], [Compressed Step 6 to 8], [Compressed Step 9], [Compressed Step 10], [Compressed Step 11], [Compressed Step 12], [Step 13]
Turn 16	
[Compressed Step 0], [Compressed Step 1 to 2], [Compressed Step 3], [Compressed Step 4], [Compressed Step 5], [Compressed Step 6 to 8], [Compressed Step 9], [Compressed Step 10], [Compressed Step 11], [Compressed Step 12], [Compressed Step 13], [Step 14]
Turn 17	
[Compressed Step 0], [Compressed Step 1 to 2], [Compressed Step 3], [Compressed Step 4], [Compressed Step 5], [Compressed Step 6 to 8], [Compressed Step 9], [Compressed Step 10], [Compressed Step 11], [Compressed Step 12], [Compressed Step 13], [Compressed Step 14], [Step 15]
Turn 18	
[Compressed Step 0], [Compressed Step 1 to 2], [Compressed Step 3], [Compressed Step 4], [Compressed Step 5], [Compressed Step 6 to 8], [Compressed Step 9], [Compressed Step 10], [Compressed Step 11], [Compressed Step 12], [Compressed Step 13], [Compressed Step 14], [Compressed Step 15], [Step 16]
Turn 19	
[Compressed Step 0], [Compressed Step 1 to 2], [Compressed Step 3], [Compressed Step 4], [Compressed Step 5], [Compressed Step 6 to 16], [Step 17]
Turn 20	
[Compressed Step 0], [Compressed Step 1 to 2], [Compressed Step 3], [Compressed Step 4], [Compressed Step 5], [Compressed Step 6 to 16], [Compressed Step 17], [Step 18]
Turn 21	
[Compressed Step 0], [Compressed Step 1 to 2], [Compressed Step 3], [Compressed Step 4], [Compressed Step 5], [Compressed Step 6 to 16], [Compressed Step 17], [Compressed Step 18], [Step 19]
Turn 22	
[Compressed Step 0], [Compressed Step 1 to 2], [Compressed Step 3], [Compressed Step 4], [Compressed Step 5], [Compressed Step 6 to 16], [Compressed Step 17], [Compressed Step 18], [Compressed Step 19], [Step 20]
Turn 23	
[Compressed Step 0], [Compressed Step 1 to 2], [Compressed Step 3], [Compressed Step 4], [Compressed Step 5], [Compressed Step 6 to 16], [Compressed Step 17], [Compressed Step 18], [Compressed Step 19], [Compressed Step 20], [Step 21]
Turn 24	
[Compressed Step 0], [Compressed Step 1 to 2], [Compressed Step 3], [Compressed Step 4], [Compressed Step 5], [Compressed Step 6 to 16], [Compressed Step 17], [Compressed Step 18], [Compressed Step 19], [Compressed Step 20], [Compressed Step 21], [Step 22]
Turn 25	
[Compressed Step 0], [Compressed Step 1 to 2], [Compressed Step 3], [Compressed Step 4], [Compressed Step 5], [Compressed Step 6 to 16], [Compressed Step 17], [Compressed Step 18], [Compressed Step 19], [Compressed Step 20], [Compressed Step 21], [Compressed Step 22], [Step 23]
Turn 26	
[Compressed Step 0], [Compressed Step 1 to 2], [Compressed Step 3], [Compressed Step 4], [Compressed Step 5], [Compressed Step 6 to 16], [Compressed Step 17], [Compressed Step 18], [Compressed Step 19], [Compressed Step 20], [Compressed Step 21], [Compressed Step 22], [Compressed Step 23], [Step 24]
Turn 27	
[Compressed Step 0], [Compressed Step 1 to 2], [Compressed Step 3], [Compressed Step 4], [Compressed Step 5], [Compressed Step 6 to 16], [Compressed Step 17], [Compressed Step 18], [Compressed Step 19], [Compressed Step 20], [Compressed Step 21], [Compressed Step 22], [Compressed Step 23], [Compressed Step 24], [Step 25]
Turn 28	
[Compressed Step 0], [Compressed Step 1 to 2], [Compressed Step 3], [Compressed Step 4], [Compressed Step 5], [Compressed Step 6 to 16], [Compressed Step 17], [Compressed Step 18], [Compressed Step 19], [Compressed Step 20], [Compressed Step 21], [Compressed Step 22], [Compressed Step 23], [Compressed Step 24], [Compressed Step 25], [Step 26]
Turn 29	
[Compressed Step 0], [Compressed Step 1 to 2], [Compressed Step 3], [Compressed Step 4], [Compressed Step 5], [Compressed Step 6 to 16], [Compressed Step 17], [Compressed Step 18], [Compressed Step 19], [Compressed Step 20], [Compressed Step 21], [Compressed Step 22], [Compressed Step 23], [Compressed Step 24], [Compressed Step 25], [Compressed Step 26], [Step 27]
Turn 30	
[Compressed Step 0], [Compressed Step 1 to 2], [Compressed Step 3], [Compressed Step 4], [Compressed Step 5], [Compressed Step 6 to 16], [Compressed Step 17], [Compressed Step 18], [Compressed Step 19], [Compressed Step 20], [Compressed Step 21 to 27], [Step 28]
Turn 31	
[Compressed Step 0], [Compressed Step 1 to 2], [Compressed Step 3], [Compressed Step 4], [Compressed Step 5], [Compressed Step 6 to 16], [Compressed Step 17], [Compressed Step 18], [Compressed Step 19], [Compressed Step 20], [Compressed Step 21 to 27], [Compressed Step 28], [Step 29]
Turn 32	
[Compressed Step 0], [Compressed Step 1 to 2], [Compressed Step 3], [Compressed Step 4], [Compressed Step 5], [Compressed Step 6 to 16], [Compressed Step 17], [Compressed Step 18], [Compressed Step 19], [Compressed Step 20], [Compressed Step 21 to 27], [Compressed Step 28], [Compressed Step 29], [Step 30]
Turn 33	
[Compressed Step 0], [Compressed Step 1 to 2], [Compressed Step 3], [Compressed Step 4], [Compressed Step 5], [Compressed Step 6 to 16], [Compressed Step 17], [Compressed Step 18], [Compressed Step 19], [Compressed Step 20], [Compressed Step 21 to 27], [Compressed Step 28], [Compressed Step 29], [Compressed Step 30], [Step 31]
Turn 34	
[Compressed Step 0], [Compressed Step 1 to 2], [Compressed Step 3], [Compressed Step 4], [Compressed Step 5], [Compressed Step 6 to 16], [Compressed Step 17], [Compressed Step 18], [Compressed Step 19], [Compressed Step 20], [Compressed Step 21 to 27], [Compressed Step 28], [Compressed Step 29], [Compressed Step 30], [Compressed Step 31], [Step 32]
Turn 35	
[Compressed Step 0], [Compressed Step 1 to 2], [Compressed Step 3], [Compressed Step 4], [Compressed Step 5], [Compressed Step 6 to 16], [Compressed Step 17], [Compressed Step 18], [Compressed Step 19], [Compressed Step 20], [Compressed Step 21 to 27], [Compressed Step 28], [Compressed Step 29], [Compressed Step 30], [Compressed Step 31], [Compressed Step 32], [Step 33]
 
Table 2:(Continued) Case Study
Refer to caption
Figure 6:Context of case 1 at step 17.
Refer to caption
Figure 7:Response of case 1 at step 17.
Table 3:Case Study 2
Turn ID	
Context
Turn 1	
Turn 2	
[Step 0]
Turn 3	
[Compressed Step 0], [Step 1]
Turn 4	
[Compressed Step 0 to 1], [Step 2]
Turn 5	
[Compressed Step 0 to 2], [Step 3]
Turn 6	
[Compressed Step 0 to 2], [Compressed Step 3], [Step 4]
Turn 7	
[Compressed Step 0 to 2], [Compressed Step 3], [Compressed Step 4], [Step 5]
Turn 8	
[Compressed Step 0 to 2], [Compressed Step 3], [Compressed Step 4], [Compressed Step 5], [Step 6]
Turn 9	
[Compressed Step 0 to 2], [Compressed Step 3], [Compressed Step 4], [Compressed Step 5], [Compressed Step 6], [Step 7]
Turn 10	
[Compressed Step 0 to 2], [Compressed Step 3], [Compressed Step 4], [Compressed Step 5], [Compressed Step 6], [Compressed Step 7], [Step 8]
Turn 11	
[Compressed Step 0 to 2], [Compressed Step 3], [Compressed Step 4], [Compressed Step 5], [Compressed Step 6], [Compressed Step 7], [Compressed Step 8], [Step 9]
Turn 12	
[Compressed Step 0 to 9], [Step 10]
Turn 13	
[Compressed Step 0 to 9], [Compressed Step 10], [Step 11]
Turn 14	
[Compressed Step 0 to 9], [Compressed Step 10], [Compressed Step 11], [Step 12]
Turn 15	
[Compressed Step 0 to 9], [Compressed Step 10], [Compressed Step 11], [Compressed Step 12], [Step 13]
Turn 16	
[Compressed Step 0 to 9], [Compressed Step 10], [Compressed Step 11], [Compressed Step 12], [Compressed Step 13], [Step 14]
Turn 17	
[Compressed Step 0 to 9], [Compressed Step 10], [Compressed Step 11], [Compressed Step 12], [Compressed Step 13], [Compressed Step 14], [Step 15]
Turn 18	
[Compressed Step 0 to 9], [Compressed Step 10], [Compressed Step 11], [Compressed Step 12], [Compressed Step 13], [Compressed Step 14], [Compressed Step 15], [Step 16]
Turn 19	
[Compressed Step 0 to 9], [Compressed Step 10], [Compressed Step 11], [Compressed Step 12], [Compressed Step 13], [Compressed Step 14], [Compressed Step 15], [Compressed Step 16], [Step 17]
Turn 20	
[Compressed Step 0 to 9], [Compressed Step 10], [Compressed Step 11], [Compressed Step 12], [Compressed Step 13], [Compressed Step 14], [Compressed Step 15], [Compressed Step 16], [Compressed Step 17], [Step 18]
Turn 21	
[Compressed Step 0 to 9], [Compressed Step 10], [Compressed Step 11], [Compressed Step 12], [Compressed Step 13], [Compressed Step 14], [Compressed Step 15], [Compressed Step 16], [Compressed Step 17], [Compressed Step 18], [Step 19]
Turn 22	
[Compressed Step 0 to 9], [Compressed Step 10], [Compressed Step 11], [Compressed Step 12], [Compressed Step 13], [Compressed Step 14], [Compressed Step 15], [Compressed Step 16], [Compressed Step 17], [Compressed Step 18], [Compressed Step 19], [Step 20]
Turn 23	
[Compressed Step 0 to 9], [Compressed Step 10], [Compressed Step 11], [Compressed Step 12], [Compressed Step 13], [Compressed Step 14], [Compressed Step 15], [Compressed Step 16], [Compressed Step 17], [Compressed Step 18], [Compressed Step 19], [Compressed Step 20], [Step 21]
Turn 24	
[Compressed Step 0 to 9], [Compressed Step 10], [Compressed Step 11], [Compressed Step 12], [Compressed Step 13], [Compressed Step 14], [Compressed Step 15], [Compressed Step 16], [Compressed Step 17], [Compressed Step 18], [Compressed Step 19], [Compressed Step 20], [Compressed Step 21], [Step 22]
Turn 25	
[Compressed Step 0 to 22], [Step 23]
Turn 26	
[Compressed Step 0 to 22], [Compressed Step 23], [Step 24]
Turn 27	
[Compressed Step 0 to 22], [Compressed Step 23], [Compressed Step 24], [Step 25]
Turn 28	
[Compressed Step 0 to 22], [Compressed Step 23], [Compressed Step 24], [Compressed Step 25], [Step 26]
Turn 29	
[Compressed Step 0 to 22], [Compressed Step 23], [Compressed Step 24], [Compressed Step 25], [Compressed Step 26], [Step 27]
Turn 30	
[Compressed Step 0 to 22], [Compressed Step 23], [Compressed Step 24], [Compressed Step 25], [Compressed Step 26], [Compressed Step 27], [Step 28]
Turn 31	
[Compressed Step 0 to 22], [Compressed Step 23], [Compressed Step 24], [Compressed Step 25], [Compressed Step 26], [Compressed Step 27], [Compressed Step 28], [Step 29]
Turn 32	
[Compressed Step 0 to 22], [Compressed Step 23], [Compressed Step 24], [Compressed Step 25], [Compressed Step 26], [Compressed Step 27], [Compressed Step 28], [Compressed Step 29], [Step 30]
Turn 33	
[Compressed Step 0 to 22], [Compressed Step 23], [Compressed Step 24], [Compressed Step 25], [Compressed Step 26], [Compressed Step 27], [Compressed Step 28], [Compressed Step 29], [Compressed Step 30], [Step 31]
Turn 34	
[Compressed Step 0 to 22], [Compressed Step 23], [Compressed Step 24], [Compressed Step 25], [Compressed Step 26], [Compressed Step 27], [Compressed Step 28], [Compressed Step 29], [Compressed Step 30], [Compressed Step 31], [Step 32]
Turn 35	
[Compressed Step 0 to 22], [Compressed Step 23], [Compressed Step 24], [Compressed Step 25], [Compressed Step 26], [Compressed Step 27], [Compressed Step 28], [Compressed Step 29], [Compressed Step 30], [Compressed Step 31], [Compressed Step 32], [Step 33]
Turn 36	
[Compressed Step 0 to 22], [Compressed Step 23], [Compressed Step 24], [Compressed Step 25], [Compressed Step 26], [Compressed Step 27], [Compressed Step 28], [Compressed Step 29], [Compressed Step 30], [Compressed Step 31], [Compressed Step 32], [Compressed Step 33], [Step 34]
Turn 37	
[Compressed Step 0 to 34], [Step 35]
Turn 38	
[Compressed Step 0 to 34], [Compressed Step 35], [Step 36]
Turn 39	
[Compressed Step 0 to 34], [Compressed Step 35], [Compressed Step 36], [Step 37]
Turn 40	
[Compressed Step 0 to 34], [Compressed Step 35], [Compressed Step 36], [Compressed Step 37], [Step 38]
Turn 41	
[Compressed Step 0 to 34], [Compressed Step 35], [Compressed Step 36], [Compressed Step 37], [Compressed Step 38], [Step 39]
Turn 42	
[Compressed Step 0 to 34], [Compressed Step 35], [Compressed Step 36], [Compressed Step 37], [Compressed Step 38], [Compressed Step 39], [Step 40]
Turn 43	
[Compressed Step 0 to 34], [Compressed Step 35], [Compressed Step 36], [Compressed Step 37], [Compressed Step 38], [Compressed Step 39], [Compressed Step 40], [Step 41]
Turn 44	
[Compressed Step 0 to 34], [Compressed Step 35], [Compressed Step 36], [Compressed Step 37], [Compressed Step 38], [Compressed Step 39], [Compressed Step 40], [Compressed Step 41], [Step 42]
Turn 45	
[Compressed Step 0 to 34], [Compressed Step 35], [Compressed Step 36], [Compressed Step 37], [Compressed Step 38], [Compressed Step 39], [Compressed Step 40], [Compressed Step 41], [Compressed Step 42], [Step 43]
Turn 46	
[Compressed Step 0 to 34], [Compressed Step 35], [Compressed Step 36], [Compressed Step 37], [Compressed Step 38], [Compressed Step 39], [Compressed Step 40], [Compressed Step 41], [Compressed Step 42], [Compressed Step 43], [Step 44]
Turn 47	
[Compressed Step 0 to 44], [Step 45]
Turn 48	
[Compressed Step 0 to 44], [Compressed Step 45], [Step 46]
Turn 49	
[Compressed Step 0 to 44], [Compressed Step 45], [Compressed Step 46], [Step 47]
Turn 50	
[Compressed Step 0 to 44], [Compressed Step 45], [Compressed Step 46], [Compressed Step 47], [Step 48]
Turn 51	
[Compressed Step 0 to 44], [Compressed Step 45], [Compressed Step 46], [Compressed Step 47], [Compressed Step 48], [Step 49]
Turn 52	
[Compressed Step 0 to 44], [Compressed Step 45], [Compressed Step 46], [Compressed Step 47], [Compressed Step 48], [Compressed Step 49], [Step 50]
Turn 53	
[Compressed Step 0 to 44], [Compressed Step 45], [Compressed Step 46], [Compressed Step 47], [Compressed Step 48], [Compressed Step 49], [Compressed Step 50], [Step 51]
Turn 54	
[Compressed Step 0 to 44], [Compressed Step 45], [Compressed Step 46], [Compressed Step 47], [Compressed Step 48], [Compressed Step 49], [Compressed Step 50], [Compressed Step 51], [Step 52]
Turn 55	
[Compressed Step 0 to 44], [Compressed Step 45], [Compressed Step 46], [Compressed Step 47], [Compressed Step 48], [Compressed Step 49], [Compressed Step 50], [Compressed Step 51], [Compressed Step 52], [Step 53]
Turn 56	
[Compressed Step 0 to 44], [Compressed Step 45], [Compressed Step 46], [Compressed Step 47], [Compressed Step 48], [Compressed Step 49], [Compressed Step 50], [Compressed Step 51], [Compressed Step 52], [Compressed Step 53], [Step 54]
Turn 57	
[Compressed Step 0 to 44], [Compressed Step 45], [Compressed Step 46], [Compressed Step 47], [Compressed Step 48], [Compressed Step 49], [Compressed Step 50], [Compressed Step 51], [Compressed Step 52], [Compressed Step 53], [Compressed Step 54], [Step 55]
Turn 58	
[Compressed Step 0 to 44], [Compressed Step 45], [Compressed Step 46], [Compressed Step 47], [Compressed Step 48], [Compressed Step 49], [Compressed Step 50], [Compressed Step 51], [Compressed Step 52], [Compressed Step 53], [Compressed Step 54], [Compressed Step 55], [Step 56]
Turn 59	
[Compressed Step 0 to 44], [Compressed Step 45], [Compressed Step 46], [Compressed Step 47], [Compressed Step 48], [Compressed Step 49], [Compressed Step 50], [Compressed Step 51], [Compressed Step 52], [Compressed Step 53], [Compressed Step 54], [Compressed Step 55], [Compressed Step 56], [Step 57]
Turn 60	
[Compressed Step 0 to 44], [Compressed Step 45], [Compressed Step 46], [Compressed Step 47], [Compressed Step 48], [Compressed Step 49], [Compressed Step 50], [Compressed Step 51], [Compressed Step 52], [Compressed Step 53], [Compressed Step 54], [Compressed Step 55], [Compressed Step 56], [Compressed Step 57], [Step 58]
 
Table 3:(Continued) Case Study 2
Refer to caption
Figure 8:Context of case 2 at step 45.
Refer to caption
Figure 9:Response of case 2 at step 45.