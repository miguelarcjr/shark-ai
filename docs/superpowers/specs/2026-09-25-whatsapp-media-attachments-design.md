# WhatsApp Media Attachments & `send_file` Tool Design Specification

## Overview
Shark AI operates with a channel-agnostic core engine (`AgentEngine`) connected to specialized channel adapters (`CliAdapter`, `WhatsAppAdapter`, etc.). While `OutboundMediaAttachment` is already declared in `src/core/engine/events.ts`, the agent lacks a dedicated tool to send generated artifacts (such as Playwright E2E test video recordings, e.g. `.webm`, screenshots, PDFs, and exported files) to the user, and the channel adapters do not yet handle media transmission.

This specification details:
1. A new agent tool: **`send_file`** (`path`, `caption`).
2. MIME-type detection and dispatch via `AgentActionExecutor` emitting `OutboundMediaAttachment`.
3. Transport and adapter support in **`WhatsAppTransport`** and **`WhatsAppAdapter`** with Baileys.
4. Terminal presentation fallback in **`CliAdapter`** / TUI (clickable links, size display, formatted box).
5. Error handling, size thresholds, and automatic fallback for WhatsApp file limits.

---

## Architecture & Data Flow

```
                      LLM Agent
                         │
                 action: send_file { path, caption }
                         │
                         ▼
                AgentActionExecutor
                  - Resolves path relative to projectRoot
                  - Checks file existence & reads stat (file size)
                  - Detects MIME type from extension
                  - Emits OutboundMediaAttachment
                         │
        ┌────────────────┴────────────────┐
        │                                 │
        ▼                                 ▼
  WhatsAppAdapter                     CliAdapter
   (WhatsAppTransport)             (Terminal / TUI)
        │                                 │
        ▼                                 ▼
   Baileys Send                    Display visual box:
   - Video (.webm/.mp4)            - Icon (🎬 / 🖼️ / 📄)
   - Image (.png/.jpg)             - Caption
   - Document fallback             - Clickable file:// link
```

---

## Detailed Tool Specification: `send_file`

### Parameters Schema
```typescript
interface SendFileArgs {
  path: string;       // Required: Relative path or absolute path to the target file
  caption?: string;   // Optional: Human-readable caption or description of the media
}
```

### MIME Detection Mapping
| Extension | Detected MIME Type | WhatsApp Dispatch Target |
| :--- | :--- | :--- |
| `.webm` | `video/webm` | Video (< 16 MB) or Document fallback (16 - 100 MB) |
| `.mp4` | `video/mp4` | Video (< 16 MB) or Document fallback (16 - 100 MB) |
| `.mov`, `.mkv` | `video/quicktime`, `video/x-matroska` | Video or Document |
| `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif` | `image/png`, `image/jpeg`, etc. | Image |
| `.pdf`, `.zip`, `.log`, `.json`, etc. | `application/pdf`, `application/octet-stream`, etc. | Document |

### Execution Behavior in `AgentActionExecutor`
1. Resolves `filePath`: `path.isAbsolute(args.path) ? args.path : path.resolve(this.projectRoot, args.path)`.
2. Validates file existence:
   - If not found: returns `[Action send_file Failed]: Arquivo '${args.path}' não encontrado.`
3. Determines MIME type and reads file stats.
4. Emits outbound event:
   ```typescript
   this.emitOutbound({
       type: 'media_attachment',
       sessionId: this.sessionId,
       filePath: resolvedPath,
       mimeType,
       caption: args.caption
   });
   ```
5. Returns confirmation string: `[Action send_file Success]: Arquivo '${path.basename(resolvedPath)}' (${mimeType}) enviado com sucesso.`

---

## Channel Adapter Implementations

### 1. `WhatsAppTransport` & `WhatsAppAdapter`

#### Interface Extension (`src/core/adapters/whatsapp/whatsapp-adapter.ts`)
```typescript
export interface WhatsAppTransport {
    sendText(chatId: string, text: string): Promise<void>;
    editMessage?(chatId: string, messageId: string, text: string): Promise<void>;
    sendMedia?(chatId: string, media: {
        filePath: string;
        mimeType: string;
        caption?: string;
        fileName?: string;
    }): Promise<void>;
    onRawMessage(handler: (chatId: string, text: string, senderId: string) => void): void;
}
```

#### Event Handling in `WhatsAppAdapter.emit(event)`
- When `event.type === 'media_attachment'`:
  - Extracts `chatId` from `event.sessionId.replace(/^whatsapp:dm:/, '')`.
  - If `this.transport.sendMedia` is provided:
    - Calls `this.transport.sendMedia(chatId, { filePath, mimeType, caption, fileName })`.
  - Fallback: If `sendMedia` is not implemented on the transport, formats a text message with file path and caption.

### 2. Baileys Bot Driver (`examples/whatsapp-bot/src/index.ts`)
- Implements `sendMedia(chatId, media)`:
  - Reads file buffer synchronously or streams via `fs.readFileSync(media.filePath)`.
  - Checks file size:
    - If `size > 100 * 1024 * 1024` (100 MB limit): sends text notice that file exceeds WhatsApp 100 MB limit.
    - If `size > 16 * 1024 * 1024` and MIME starts with `video/`: automatically sends as `document` to avoid WhatsApp video compression/size rejection.
  - Video payload:
    `await sock.sendMessage(chatId, { video: buffer, mimetype: media.mimeType, caption: media.caption, fileName: media.fileName });`
  - Image payload:
    `await sock.sendMessage(chatId, { image: buffer, mimetype: media.mimeType, caption: media.caption });`
  - Document payload:
    `await sock.sendMessage(chatId, { document: buffer, mimetype: media.mimeType, fileName: media.fileName, caption: media.caption });`

### 3. `CliAdapter` & TUI Rendering
- When `CliAdapter` receives `media_attachment`:
  - Renders a styled visual box:
    ```
    ┌─────────────────────────────────────────────────────────────┐
    │ 🎬 MÍDIA GERADA: video-2026-09-26T03-00-37-403Z.webm (1.4MB)│
    │ Legenda: Gravação da execução do teste E2E do Playwright   │
    │ Link local: file:///D:/projetos/.../video.webm              │
    └─────────────────────────────────────────────────────────────┘
    ```

---

## System Prompt Guidelines (`src/core/api/prompts.ts`)

1. Include `'send_file'` in the union of valid action types.
2. Add `caption` to `TOOL_ARGS_PROPERTIES`.
3. Add instruction block:
   > *"📎 ENVIO DE ARQUIVOS E MÍDIAS ('send_file'): Sempre que você gerar arquivos relevantes para visualização do usuário (ex: gravações de teste em vídeo como .webm do Playwright, screenshots .png, relatórios PDF, bundles compactados), utilize a ação 'send_file' passando o 'path' do arquivo e um 'caption' explicativo para que a mídia seja enviada diretamente no chat."*
