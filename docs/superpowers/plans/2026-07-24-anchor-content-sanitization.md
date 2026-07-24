# Anchor Content Sanitization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sanitize replacement content in `AnchorStateManager` and strengthen system prompts to prevent leaked anchor prefixes (`<word>§`) from polluting source code during `modify_file`.

**Architecture:** Add a `sanitizeContent` regex-based cleaner in `AnchorStateManager.applyAnchoredEdit` to strip leading `^[a-zA-Z0-9_]+§` from lines in replacement content, accompanied by unit tests and updated prompt guidelines in `prompts.ts`.

**Tech Stack:** TypeScript, Node.js, Vitest.

## Global Constraints
- Do not alter existing anchor mapping logic or public API signatures.
- Preserve trailing newlines and line alignment during edits.

---

### Task 1: Add Content Sanitization in AnchorStateManager

**Files:**
- Modify: `src/core/workflow/anchor-state-manager.ts:170-200`
- Test: `src/core/workflow/anchor-state-manager.test.ts`

**Interfaces:**
- Consumes: `AnchorStateManager.applyAnchoredEdit(filePath: string, startAnchor: string, endAnchor: string, content: string): void`
- Produces: Sanitized `content` with any leading `^[a-zA-Z0-9_]+§` stripped before diffing or writing to disk.

- [ ] **Step 1: Write the failing unit test**

In `src/core/workflow/anchor-state-manager.test.ts`, add:
```ts
it('should strip leaked anchor prefixes from replacement content', () => {
    fs.writeFileSync(testFile, 'line1\nline2\nline3\nline4');
    try {
        const firstRead = manager.getAnchoredContent(testFile);
        const linesBefore = firstRead.split('\n');
        const anchor2 = linesBefore[1].split('§')[0];
        const anchor3 = linesBefore[2].split('§')[0];

        // Pass replacement content with leaked anchor prefixes (e.g. apple§new_lineA)
        manager.applyAnchoredEdit(testFile, anchor2, anchor3, 'apple§new_lineA\nbeach§new_lineB');

        // Content on disk should be clean without any anchor prefixes
        const onDisk = fs.readFileSync(testFile, 'utf8');
        expect(onDisk).toBe('line1\nnew_lineA\nnew_lineB\nline4');
    } finally {
        if (fs.existsSync(testFile)) {
            fs.unlinkSync(testFile);
        }
    }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/workflow/anchor-state-manager.test.ts`
Expected: FAIL (disk content contains `apple§new_lineA`).

- [ ] **Step 3: Write minimal implementation in AnchorStateManager**

In `src/core/workflow/anchor-state-manager.ts`:
Add `private sanitizeContent`:
```ts
private sanitizeContent(content: string): string {
    if (!content) return content;
    const lines = content.split('\n');
    const sanitizedLines = lines.map(line => line.replace(/^[a-zA-Z0-9_]+§/, ''));
    return sanitizedLines.join('\n');
}
```
And in `applyAnchoredEdit`:
```ts
const cleanInput = this.sanitizeContent(content);
const cleanContent = cleanInput.endsWith('\n') ? cleanInput.slice(0, -1) : cleanInput;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/workflow/anchor-state-manager.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/workflow/anchor-state-manager.ts src/core/workflow/anchor-state-manager.test.ts
git commit -m "fix(anchor): sanitize leaked anchor prefixes in replacement content"
```

---

### Task 2: Clarify System Prompts in prompts.ts

**Files:**
- Modify: `src/core/api/prompts.ts:4-12` and `65-68`

**Interfaces:**
- Consumes: None
- Produces: Updated `UNIFIED_SYSTEM_PROMPT` and `SUBAGENT_SYSTEM_PROMPT` strings.

- [ ] **Step 1: Update UNIFIED_SYSTEM_PROMPT and SUBAGENT_SYSTEM_PROMPT**

In `src/core/api/prompts.ts`, update the Anchor System guidelines under `UNIFIED_SYSTEM_PROMPT`:
```ts
- Importante: Use APENAS a palavra âncora no campo 'start_anchor' e 'end_anchor' (por exemplo: 'apple'), e NÃO a linha inteira ou o separador '§'.
- ⚠️ REGRA CRÍTICA DO CAMPO 'content': O campo 'content' deve conter APENAS o código-fonte limpo a ser inserido. NUNCA inclua os prefixos de âncora (como 'apple§' ou 'apple') dentro do campo 'content'.
  - ❌ ERRADO: "content": "apple§const x = 10;"
  - ✅ CERTO:  "content": "const x = 10;"
```
And similarly update `SUBAGENT_SYSTEM_PROMPT` anchor rules.

- [ ] **Step 2: Verify build / tests pass**

Run: `npx vitest run src/core/workflow/anchor-state-manager.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/core/api/prompts.ts
git commit -m "docs(prompts): add explicit rules against anchor leaks in modify_file content"
```
