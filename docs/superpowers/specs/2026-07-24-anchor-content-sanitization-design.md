# Anchor Content Sanitization Design

## Overview
When Shark Dev or subagents edit files using `modify_file`, they specify `start_anchor`, `end_anchor`, and replacement `content`. Because `read_file` returns lines formatted with anchor prefixes (`anchor_word§line_text`), the LLM occasionally leaks `anchor_word§` prefixes (e.g. `apple§const x = 10;`) into the `content` field.
When written to disk, these leaked anchor markers introduce syntax errors and break code files.

This design introduces a hybrid defense mechanism:
1. **Backend Sanitization**: `AnchorStateManager` automatically strips `^[a-zA-Z0-9_]+§` prefixes from replacement content before writing to disk.
2. **Prompt Clarification**: `UNIFIED_SYSTEM_PROMPT` and `SUBAGENT_SYSTEM_PROMPT` receive explicit negative rules and examples prohibiting anchor markers in `content`.

## Goals
- Guarantee that code written by `modify_file` is never polluted with `anchor§` line prefixes or anchor artifacts.
- Prevent LLM confusion by clarifying prompt instructions for `modify_file`'s `content` property.
- Add comprehensive unit tests verifying that anchor leakage is handled safely and transparently.

## Proposed Changes

### 1. Backend Sanitization (`src/core/workflow/anchor-state-manager.ts`)

#### [MODIFY] [anchor-state-manager.ts](file:///d:/projetos/bmadspot/src/core/workflow/anchor-state-manager.ts)
- Implement `private sanitizeContent(content: string): string` in `AnchorStateManager`:
  ```ts
  private sanitizeContent(content: string): string {
      if (!content) return content;
      const lines = content.split('\n');
      const sanitizedLines = lines.map(line => line.replace(/^[a-zA-Z0-9_]+§/, ''));
      return sanitizedLines.join('\n');
  }
  ```
- In `applyAnchoredEdit(filePath, startAnchor, endAnchor, content)`, invoke `sanitizeContent(content)` on the incoming `content` before computing diffs or writing to disk.

### 2. Unit Tests (`src/core/workflow/anchor-state-manager.test.ts`)

#### [MODIFY] [anchor-state-manager.test.ts](file:///d:/projetos/bmadspot/src/core/workflow/anchor-state-manager.test.ts)
- Add unit test `should strip leaked anchor prefixes from replacement content`:
  - Write test file with lines.
  - Execute `applyAnchoredEdit` passing `content` with leaked `word§` prefixes.
  - Assert that disk content is saved clean without any `word§` prefixes.

### 3. Prompt Guidance (`src/core/api/prompts.ts`)

#### [MODIFY] [prompts.ts](file:///d:/projetos/bmadspot/src/core/api/prompts.ts)
- Update `UNIFIED_SYSTEM_PROMPT` and `SUBAGENT_SYSTEM_PROMPT` under the Anchor System section:
  ```text
  - Importante: Use APENAS a palavra âncora nos campos 'start_anchor' e 'end_anchor' (ex: 'apple').
  - ⚠️ REGRA CRÍTICA DO CAMPO 'content': O campo 'content' deve conter APENAS o código-fonte limpo a ser inserido. NUNCA inclua os prefixos de âncora (ex: 'apple§' ou 'apple') dentro do campo 'content'.
    - ❌ ERRADO: "content": "apple§const x = 10;"
    - ✅ CERTO:  "content": "const x = 10;"
  ```

## Verification Plan

### Automated Tests
- Run vitest suite for anchor state manager:
  `npx vitest run src/core/workflow/anchor-state-manager.test.ts`

### Manual Verification
- Review code changes and confirm vitest execution passes cleanly.
