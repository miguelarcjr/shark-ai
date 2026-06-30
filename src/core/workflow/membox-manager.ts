import * as fs from 'fs';
import * as path from 'path';
import crypto from 'node:crypto';
import { EmbeddingService } from './embedding-service.js';
import { jsonrepair } from 'jsonrepair';

export interface Membox {
    box_id: number;
    start_time: string;
    coverage: {
        session_id: string;
        start_step: number;
        end_step: number;
    };
    content_text: string;
    features: {
        topic: string;
        keywords: string[];
        events: string[];
        events_text: string;
    };
}

export interface TraceEntry {
    box_id: number;
    start_time: string;
    events: string[];
    order: number;
}

export interface Trace {
    trace_id: number;
    box_ids: number[];
    entries: TraceEntry[];
    entries_text: string;
}

// English Prompt Constants for better LLM conformance and formatting
const PROMPT_BATCH_TOPIC_LOOM = `You are a topic segmentation assistant. Analyze the following list of messages and partition them into cohesive topic segments.
Each message is numbered with an index.

Messages:
{messagesText}

Respond ONLY with a JSON object containing a "boundaries" array. Each boundary must specify the "start" and "end" indices (inclusive) of a segment, like this:
{
  "boundaries": [
    { "start": 0, "end": 1 },
    { "start": 2, "end": 3 }
  ]
}

Ensure all messages are covered and every segment has at least 2 messages (minimal context rule). Do NOT leave gaps between segments.`;

const PROMPT_TOPIC_CONTINUITY = `You are a topic continuity analyzer. Determine if the current message (curr) continues the same topic as the reference messages (ref).

Reference Messages (ref):
{refText}

Current Message (curr):
{currText}

Respond with "Yes" if it continues the same topic, or "No" if it is a different topic.`;

const PROMPT_BATCH_METADATA_EXTRACTION = `For each of the following partitioned conversation segments, extract the main topic (topic), key keywords (keywords), and a list of explicit events, actions, or future plans (explicit_mentions).

Segments:
{segmentsText}

Respond ONLY with a JSON object containing a "segments" array where each item corresponds to the segment index, like this:
{
  "segments": [
    {
      "segment_index": 0,
      "topic": "Topic Name",
      "keywords": ["kw1", "kw2"],
      "explicit_mentions": ["event1", "event2"]
    }
  ]
}`;

const PROMPT_METADATA_EXTRACTION = `Analyze the dialogue below and extract the main topic (topic), key keywords (keywords), and a list of explicit events, actions, or future plans (explicit_mentions).

Dialogue:
{segmentText}

Respond ONLY with a JSON object containing the keys: "topic", "keywords" (array of strings), and "explicit_mentions" (array of strings).`;

const PROMPT_TOPIC_FALLBACK = `Based on the following dialogue, extract a single simple sentence summarizing the main topic.

Dialogue:
{segmentText}`;

const PROMPT_KEYWORDS_FALLBACK = `Based on the following dialogue, extract up to 5 important keywords. Respond with a comma-separated list of keywords.

Dialogue:
{segmentText}`;

const PROMPT_EVENTS_FALLBACK = `Based on the following dialogue, list the key explicit actions, decisions, or events. Respond with a simple list of events, one per line.

Dialogue:
{segmentText}`;

const PROMPT_BATCH_TRACE_LINKING = `You are a narrative linking assistant. Map the following New Events to the matching Existing Traces.

New Events:
{newEventsText}

Existing Traces:
{tracesText}

Respond ONLY with a JSON object in this format, detailing which events are related to which trace_id, and which events do not match any existing trace:
{
  "mappings": [
    {
      "trace_id": 0,
      "related_events": ["event text from list"]
    }
  ],
  "unmatched_events": ["event text from list that has no match"]
}`;

const PROMPT_TRACE_LINKING = `You are a narrative coherence analyzer. Identify if any of the New Events are directly related to the Existing Trace (same project, error, file, or topic).

Existing Trace Events:
{traceEvents}

New Events:
{newEvents}

Respond ONLY with a JSON object in this format:
{
  "related_events": ["..."],
  "unrelated_events": ["..."]
}`;

const PROMPT_TRACE_NARRATIVE = `Organize the events below into a coherent logical chain (primary_chain) and isolated events (isolated_events).

Events:
{events}

Respond ONLY with a JSON object in this format:
{
  "primary_chain": ["..."],
  "isolated_events": ["..."]
}`;

export class MemboxManager {
    private storageDir: string;
    private boxesPath: string;
    private tracesPath: string;
    private embeddingService: EmbeddingService;
    private runId?: string;

    // In-memory caches to optimize disk I/O
    private boxesCache: Membox[] | null = null;
    private tracesCache: Trace[] | null = null;

    constructor(storageDirOrRunId?: string) {
        let baseDir = '.shark/membox';
        let runId: string | undefined = undefined;

        if (storageDirOrRunId) {
            if (storageDirOrRunId.includes('/') || storageDirOrRunId.includes('\\') || storageDirOrRunId.startsWith('.')) {
                baseDir = storageDirOrRunId;
            } else {
                runId = storageDirOrRunId;
            }
        }

        const targetDir = runId ? path.join('.shark/membox', runId) : baseDir;
        this.storageDir = targetDir;
        this.runId = runId;
        this.boxesPath = path.join(targetDir, 'boxes.jsonl');
        this.tracesPath = path.join(targetDir, 'traces.jsonl');
        this.embeddingService = new EmbeddingService(targetDir);

        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }
    }

    public saveBox(box: Membox) {
        if (this.boxesCache) {
            this.boxesCache.push(box);
        }
        fs.appendFileSync(this.boxesPath, JSON.stringify(box) + '\n', 'utf8');
    }

    public saveTrace(trace: Trace) {
        if (this.tracesCache) {
            this.tracesCache.push(trace);
        }
        fs.appendFileSync(this.tracesPath, JSON.stringify(trace) + '\n', 'utf8');
    }

    public loadBoxes(): Membox[] {
        if (this.boxesCache) return this.boxesCache;
        if (!fs.existsSync(this.boxesPath)) return [];
        const content = fs.readFileSync(this.boxesPath, 'utf8');
        this.boxesCache = content.split('\n')
            .filter(line => line.trim())
            .map(line => JSON.parse(line));
        return this.boxesCache;
    }

    public loadTraces(): Trace[] {
        if (this.tracesCache) return this.tracesCache;
        if (!fs.existsSync(this.tracesPath)) return [];
        const content = fs.readFileSync(this.tracesPath, 'utf8');
        this.tracesCache = content.split('\n')
            .filter(line => line.trim())
            .map(line => JSON.parse(line));
        return this.tracesCache;
    }

    private parseJSONSafely(text: string): any {
        let cleaned = text.trim();
        if (cleaned.startsWith('```')) {
            cleaned = cleaned.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
        }
        try {
            return JSON.parse(cleaned);
        } catch {
            try {
                return JSON.parse(jsonrepair(cleaned));
            } catch {
                return null;
            }
        }
    }

    private async callHelperLLM(prompt: string, apiProvider: any): Promise<string> {
        const response = await apiProvider.streamChat(
            prompt + '\n\nIMPORTANT: You MUST respond using the \'talk_with_user\' action. Put the result (either plain text or a JSON string matching the requested format) strictly inside the \'content\' field of the response JSON. Do NOT use other actions.',
            {
                conversationId: `membox-helper-${crypto.randomUUID()}`,
                agentType: 'developer_agent'
            }
        );
        return response.action?.content || '';
    }

    public async retrieveContext(query: string, rawTail: any[], traceEventTopN: number = 5): Promise<string> {
        const boxes = this.loadBoxes();
        if (boxes.length === 0) return '';

        const qVec = await this.embeddingService.getEmbedding(query);
        const scoredBoxes: { box: Membox; score: number }[] = [];

        for (const box of boxes) {
            const textToEmbed = `${box.content_text} ${box.features.events_text} ${box.features.topic} ${box.features.keywords.join(' ')}`;
            const bVec = await this.embeddingService.getEmbedding(textToEmbed);
            const score = this.embeddingService.cosineSimilarity(qVec, bVec);
            scoredBoxes.push({ box, score });
        }

        // Selecionar caixas usando estratégia híbrida
        let selectedBoxes: Membox[] = [];
        if (boxes.length <= 8) {
            selectedBoxes = [...boxes];
        } else {
            // 1. Sempre incluir a Box 0
            const box0 = boxes.find(b => b.box_id === 0);
            if (box0) selectedBoxes.push(box0);

            // 2. Sempre incluir as 2 caixas mais recentes
            const recentBoxes = boxes.slice(-2);
            for (const rb of recentBoxes) {
                if (!selectedBoxes.some(b => b.box_id === rb.box_id)) {
                    selectedBoxes.push(rb);
                }
            }

            // 3. Preencher até 6 caixas com as de maior similaridade semântica
            scoredBoxes.sort((a, b) => b.score - a.score);
            for (const sb of scoredBoxes) {
                if (selectedBoxes.length >= 6) break;
                if (!selectedBoxes.some(b => b.box_id === sb.box.box_id)) {
                    selectedBoxes.push(sb.box);
                }
            }
        }

        // Ordenar cronologicamente por box_id
        selectedBoxes.sort((a, b) => a.box_id - b.box_id);
        const topBoxIds = selectedBoxes.map(b => b.box_id);

        // Event-level trace retrieval (Issues 5 & 6)
        const traces = this.loadTraces();
        
        // Coletar todos os eventos individuais pertencentes às caixas selecionadas
        const candidateEvents: { event: string; trace: Trace }[] = [];
        for (const trace of traces) {
            const hasSharedBox = trace.box_ids.some(id => topBoxIds.includes(id));
            if (hasSharedBox) {
                for (const entry of trace.entries) {
                    if (topBoxIds.includes(entry.box_id)) {
                        for (const event of entry.events) {
                            candidateEvents.push({ event, trace });
                        }
                    }
                }
            }
        }

        // Rankear esses eventos com base na similaridade com a query
        const scoredEvents: { event: string; trace: Trace; score: number }[] = [];
        for (const candidate of candidateEvents) {
            const eVec = await this.embeddingService.getEmbedding(candidate.event);
            const score = this.embeddingService.cosineSimilarity(qVec, eVec);
            scoredEvents.push({ ...candidate, score });
        }

        // Selecionar os top trace_event_topn eventos
        scoredEvents.sort((a, b) => b.score - a.score);
        const topEvents = scoredEvents.slice(0, traceEventTopN);

        // Recuperar as traces correspondentes a esses eventos selecionados
        const relevantTracesText: string[] = [];
        const retrievedTraceIds = new Set<number>();
        for (const entry of topEvents) {
            if (!retrievedTraceIds.has(entry.trace.trace_id)) {
                retrievedTraceIds.add(entry.trace.trace_id);
                if (entry.trace.entries_text) {
                    relevantTracesText.push(entry.trace.entries_text);
                }
            }
        }

        // Montar bloco de prompt
        let prompt = '\n--- MEMÓRIA DE LONGO PRAZO: TRACES TEMÁTICOS ---\n';
        if (relevantTracesText.length > 0) {
            prompt += relevantTracesText.join('\n') + '\n';
        } else {
            prompt += 'Sem traces correspondentes históricos.\n';
        }

        prompt += '\n--- MEMÓRIA EPISÓDICA: CAIXAS DE DIÁLOGOS RECUPERADAS ---\n';
        for (const box of selectedBoxes) {
            prompt += `Tópico: ${box.features.topic} [Sessão: ${box.coverage.session_id}]\n`;
            prompt += `${box.content_text}\n\n`;
        }

        return prompt;
    }

    public async compactHistory(rawMessages: any[], apiProvider: any, conversationId: string, force: boolean = false): Promise<any[]> {
        if (rawMessages.length < 10 && !force) return rawMessages;

        console.log(`[Membox] Iniciando compactação do histórico para: ${conversationId}`);

        const messagesToCompact = rawMessages.slice(0, -4);
        const rawTail = rawMessages.slice(-4);

        if (messagesToCompact.length === 0) return rawMessages;

        // 1. Batch Topic Loom: Fatiamento em lote (Batch segmentation)
        const messagesText = messagesToCompact.map((m, idx) => `[${idx}] ${m.role}: ${m.content}`).join('\n');
        const loomPrompt = PROMPT_BATCH_TOPIC_LOOM.replace('{messagesText}', messagesText);
        
        console.log('[Membox] Executando fatiamento de tópicos (Topic Loom) em lote...');
        const loomResultRaw = await this.callHelperLLM(loomPrompt, apiProvider);
        
        let segments: { msg: any; index: number }[][] = [];
        const parsedBoundaries = this.parseJSONSafely(loomResultRaw);

        if (parsedBoundaries && Array.isArray(parsedBoundaries.boundaries) && parsedBoundaries.boundaries.length > 0) {
            let valid = true;
            for (const b of parsedBoundaries.boundaries) {
                if (typeof b.start !== 'number' || typeof b.end !== 'number' || b.start > b.end || (b.end - b.start + 1) < 2) {
                    valid = false;
                    break;
                }
            }
            if (valid) {
                for (const b of parsedBoundaries.boundaries) {
                    const segmentSlice = messagesToCompact.slice(b.start, b.end + 1).map((msg, offset) => ({
                        msg,
                        index: b.start + offset
                    }));
                    if (segmentSlice.length > 0) {
                        segments.push(segmentSlice);
                    }
                }
            }
        }

        // Fallback sequencial se o batch topic loom falhou
        if (segments.length === 0) {
            console.log('[Membox] Batch Topic Loom falhou ou retornou limites inválidos. Rodando fallback sequencial...');
            let currentSegment: { msg: any; index: number }[] = [{ msg: messagesToCompact[0], index: 0 }];

            for (let i = 1; i < messagesToCompact.length; i++) {
                const msg = messagesToCompact[i];
                if (currentSegment.length < 2) {
                    currentSegment.push({ msg, index: i });
                    continue;
                }

                const refText = currentSegment.slice(-2).map(item => `${item.msg.role}: ${item.msg.content}`).join('\n');
                const currText = `${msg.role}: ${msg.content}`;

                const checkPrompt = PROMPT_TOPIC_CONTINUITY
                    .replace('{refText}', refText)
                    .replace('{currText}', currText);

                const decision = await this.callHelperLLM(checkPrompt, apiProvider);
                const isRelated = decision.trim().toLowerCase().includes('yes');

                if (isRelated) {
                    currentSegment.push({ msg, index: i });
                } else {
                    segments.push(currentSegment);
                    currentSegment = [{ msg, index: i }];
                }
            }
            if (currentSegment.length > 0) {
                segments.push(currentSegment);
            }
        }

        const existingBoxes = this.loadBoxes();
        let boxIdCounter = existingBoxes.length > 0 ? Math.max(...existingBoxes.map(b => b.box_id)) + 1 : 0;

        // 2. Batch Metadata Extraction: Extração de metadados das caixas em lote
        console.log('[Membox] Executando extração de metadados das caixas em lote...');
        let segmentsText = '';
        for (let idx = 0; idx < segments.length; idx++) {
            const segment = segments[idx];
            const text = segment.map(item => `${item.msg.role}: ${item.msg.content}`).join('\n');
            segmentsText += `--- Segment ${idx} ---\n${text}\n\n`;
        }

        const extractPrompt = PROMPT_BATCH_METADATA_EXTRACTION.replace('{segmentsText}', segmentsText);
        const extractResultRaw = await this.callHelperLLM(extractPrompt, apiProvider);
        const parsedBatchMetadata = this.parseJSONSafely(extractResultRaw);

        // Processar caixas e rodar costura
        for (let idx = 0; idx < segments.length; idx++) {
            const segment = segments[idx];
            const segmentText = segment.map(item => `${item.msg.role}: ${item.msg.content}`).join('\n');

            let topic: string | undefined = undefined;
            let keywords: string[] | undefined = undefined;
            let events: string[] | undefined = undefined;

            if (parsedBatchMetadata && Array.isArray(parsedBatchMetadata.segments)) {
                const meta = parsedBatchMetadata.segments.find((s: any) => s.segment_index === idx);
                if (meta) {
                    topic = meta.topic;
                    keywords = meta.keywords;
                    events = meta.explicit_mentions;
                }
            }

            // Fallback individual se o batch falhou
            if (!topic) {
                const topicPrompt = PROMPT_TOPIC_FALLBACK.replace('{segmentText}', segmentText);
                const rawTopic = await this.callHelperLLM(topicPrompt, apiProvider);
                topic = rawTopic.trim() || 'Developer Dialogue';
            }
            if (!keywords || !Array.isArray(keywords) || keywords.length === 0) {
                const keywordsPrompt = PROMPT_KEYWORDS_FALLBACK.replace('{segmentText}', segmentText);
                const rawKeywords = await this.callHelperLLM(keywordsPrompt, apiProvider);
                keywords = rawKeywords.split(',').map(k => k.trim()).filter(Boolean);
            }
            if (!events || !Array.isArray(events)) {
                const eventsPrompt = PROMPT_EVENTS_FALLBACK.replace('{segmentText}', segmentText);
                const rawEvents = await this.callHelperLLM(eventsPrompt, apiProvider);
                events = rawEvents.split('\n').map(e => e.trim().replace(/^-\s*/, '')).filter(Boolean);
            }

            const newBox: Membox = {
                box_id: boxIdCounter++,
                start_time: new Date().toISOString(),
                coverage: {
                    session_id: conversationId,
                    start_step: segment[0].index,
                    end_step: segment[segment.length - 1].index
                },
                content_text: segmentText,
                features: {
                    topic,
                    keywords,
                    events,
                    events_text: events.join(' | ')
                }
            };

            this.saveBox(newBox);

            if (events.length > 0) {
                await this.linkEventsToTracesBatch(newBox, events, apiProvider);
            }
        }

        console.log(`[Membox] Compactação finalizada. Caixas gravadas. Retornando cauda recente.`);
        return rawTail;
    }

    private async linkEventsToTracesBatch(box: Membox, events: string[], apiProvider: any) {
        const traces = this.loadTraces();
        const TRACE_SIMILARITY_THRESHOLD = 0.5;

        // Pre-filtering: identificar quais traces são candidatas
        const candidateTraces: Trace[] = [];
        const eventEmbeddings = await Promise.all(events.map(e => this.embeddingService.getEmbedding(e)));

        for (const trace of traces) {
            const traceEvents = trace.entries.flatMap(entry => entry.events);
            if (traceEvents.length === 0) continue;

            const traceEventEmbeddings = await Promise.all(traceEvents.map(te => this.embeddingService.getEmbedding(te)));
            let passesFilter = false;

            for (const evEmb of eventEmbeddings) {
                for (const teEmb of traceEventEmbeddings) {
                    const similarity = this.embeddingService.cosineSimilarity(evEmb, teEmb);
                    if (similarity >= TRACE_SIMILARITY_THRESHOLD) {
                        passesFilter = true;
                        break;
                    }
                }
                if (passesFilter) break;
            }

            if (passesFilter) {
                candidateTraces.push(trace);
            }
        }

        // Se não houver traces candidatas, todos criam novas
        if (candidateTraces.length === 0) {
            for (const event of events) {
                await this.createNewTrace(box, event, apiProvider, traces);
            }
            return;
        }

        // Executar vinculação em lote via LLM (Batch Trace Linking)
        console.log('[Membox] Executando vinculação de eventos a traces (Trace Weaver) em lote...');
        const newEventsText = events.map((e, idx) => `[E${idx}] ${e}`).join('\n');
        const tracesText = candidateTraces.map(t => `[T${t.trace_id}] ${t.entries_text}`).join('\n');

        const filterPrompt = PROMPT_BATCH_TRACE_LINKING
            .replace('{newEventsText}', newEventsText)
            .replace('{tracesText}', tracesText);

        const filterResRaw = await this.callHelperLLM(filterPrompt, apiProvider);
        const parsed = this.parseJSONSafely(filterResRaw);

        // Fallback individual sequencial se o lote falhar
        if (!parsed || (!Array.isArray(parsed.mappings) && !Array.isArray(parsed.unmatched_events))) {
            console.log('[Membox] Batch Trace Linking falhou. Executando fallback individual...');
            for (const event of events) {
                await this.linkSingleEventToTraces(box, event, apiProvider, traces);
            }
            return;
        }

        const matchedEvents = new Set<string>();
        if (Array.isArray(parsed.mappings)) {
            for (const map of parsed.mappings) {
                const trace = traces.find(t => t.trace_id === map.trace_id);
                if (trace && Array.isArray(map.related_events) && map.related_events.length > 0) {
                    if (!trace.box_ids.includes(box.box_id)) {
                        trace.box_ids.push(box.box_id);
                    }
                    trace.entries.push({
                        box_id: box.box_id,
                        start_time: box.start_time,
                        events: map.related_events,
                        order: trace.entries.length
                    });
                    const texts = trace.entries.map(e => `${e.start_time}: ${e.events.join(', ')}`);
                    trace.entries_text = texts.join(' -> ');
                    this.updateTraceInFile(trace);
                    for (const re of map.related_events) {
                        matchedEvents.add(re);
                    }
                }
            }
        }

        const unmatchedEvents = events.filter(e => {
            const explicitlyUnmatched = Array.isArray(parsed.unmatched_events) && parsed.unmatched_events.includes(e);
            return explicitlyUnmatched || !matchedEvents.has(e);
        });

        for (const event of unmatchedEvents) {
            await this.createNewTrace(box, event, apiProvider, traces);
        }
    }

    private async linkSingleEventToTraces(box: Membox, event: string, apiProvider: any, traces: Trace[]) {
        const TRACE_SIMILARITY_THRESHOLD = 0.5;
        let matchedAnyTrace = false;
        const eventEmbedding = await this.embeddingService.getEmbedding(event);

        for (const trace of traces) {
            const traceEvents = trace.entries.flatMap(entry => entry.events);
            if (traceEvents.length === 0) continue;

            const traceEventEmbeddings = await Promise.all(traceEvents.map(te => this.embeddingService.getEmbedding(te)));
            let bestSimilarity = -1;

            for (const teEmb of traceEventEmbeddings) {
                const similarity = this.embeddingService.cosineSimilarity(eventEmbedding, teEmb);
                if (similarity > bestSimilarity) {
                    bestSimilarity = similarity;
                }
            }

            if (bestSimilarity < TRACE_SIMILARITY_THRESHOLD) {
                continue;
            }
            const filterPrompt = PROMPT_TRACE_LINKING
                .replace('{traceEvents}', traceEvents.join('\n'))
                .replace('{newEvents}', event);

            const filterResRaw = await this.callHelperLLM(filterPrompt, apiProvider);
            const parsed = this.parseJSONSafely(filterResRaw);
            const related = parsed?.related_events || [];

            if (related.length > 0) {
                if (!trace.box_ids.includes(box.box_id)) {
                    trace.box_ids.push(box.box_id);
                }
                
                trace.entries.push({
                    box_id: box.box_id,
                    start_time: box.start_time,
                    events: related,
                    order: trace.entries.length
                });

                const texts = trace.entries.map(e => `${e.start_time}: ${e.events.join(', ')}`);
                trace.entries_text = texts.join(' -> ');

                this.updateTraceInFile(trace);
                matchedAnyTrace = true;
            }
        }

        if (!matchedAnyTrace) {
            await this.createNewTrace(box, event, apiProvider, traces);
        }
    }

    private async createNewTrace(box: Membox, event: string, apiProvider: any, traces: Trace[]) {
        const initPrompt = PROMPT_TRACE_NARRATIVE.replace('{events}', event);
        const initResRaw = await this.callHelperLLM(initPrompt, apiProvider);
        const parsed = this.parseJSONSafely(initResRaw);
        const chain = parsed?.primary_chain || [event];

        const nextTraceId = traces.length;
        const newTrace: Trace = {
            trace_id: nextTraceId,
            box_ids: [box.box_id],
            entries: [{
                box_id: box.box_id,
                start_time: box.start_time,
                events: chain,
                order: 0
            }],
            entries_text: `${box.start_time}: ${chain.join(', ')}`
        };

        this.saveTrace(newTrace);
        traces.push(newTrace);
    }

    private updateTraceInFile(updatedTrace: Trace) {
        const traces = this.loadTraces();
        const index = traces.findIndex(t => t.trace_id === updatedTrace.trace_id);
        if (index !== -1) {
            traces[index] = updatedTrace;
            this.tracesCache = traces;
            fs.writeFileSync(this.tracesPath, traces.map(t => JSON.stringify(t)).join('\n') + '\n', 'utf8');
        }
    }
}
