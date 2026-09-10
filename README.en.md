# 🦈 Shark AI

<div align="center">

```
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣠⣄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣠⣾⣿⣿⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⢀⣀⣀⣀⣀⣀⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣰⣿⣿⣿⣿⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⢠⣾⣿⣏⠉⠉⠉⠉⠉⠉⢡⣶⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠘⠻⢿⣿⣿⣿⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣤⡄⠀
⠈⣿⣿⣿⣿⣦⣽⣦⡀⠀⠀⠛⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠉⠛⢧⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣠⣿⣿⠀⠀
⠀⠘⢿⣿⣿⣿⣿⣿⣿⣦⣄⣀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣾⣿⣿⠇⠀⠀
⠀⠀⠈⠻⣿⣿⣿⣿⡟⢿⠻⠛⠙⠉⠋⠛⠳⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣠⣿⣿⣿⡟⠀⠀⠀
⠀⠀⠀⠀⠈⠙⢿⡇⣠⣤⣶⣶⣾⡉⠉⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⣰⣰⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠠⠾⢇⠀⠀⠀⠀⠀⣴⣿⣿⣿⣿⠃⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠱⣿⣿⣿⣿⣿⣿⣦⡀⠀⠀⠀⠀⠀⠀⠀⠀⣰⣿⣿⡇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠐⠤⢤⣀⣀⣀⣀⣀⣀⣠⣤⣤⣤⣬⣭⣿⣿⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠈⠛⢿⣿⣿⣿⣿⣿⣶⣤⣄⣀⣀⣠⣴⣾⣿⣿⣿⣷⣤⣀⡀⠀⠀⠀⠀⠀⠀⣀⣀⣤⣾⣿⣿⣿⣿⡿⠿⠛⠛⠻⣿⣿⣿⣿⣇⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠙⠻⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣶⣶⣤⣤⣘⡛⠿⢿⡿⠟⠛⠉⠁⠀⠀⠀⠀⠀⠈⠻⣿⣿⣿⣦⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣴⣾⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⠿⢿⣿⣿⣿⣿⣿⣶⣦⣤⣀⡀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠻⣿⣿⡄⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢠⣾⣿⣿⣿⠿⠛⠉⠁⠀⠈⠉⠙⠛⠛⠻⠿⠿⠿⠿⠟⠛⠃⠀⠀⠀⠉⠉⠉⠛⠛⠛⠿⠿⠿⣶⣦⣄⡀⠀⠀⠀⠀⠀⠈⠙⠛⠂
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠠⠿⠛⠋⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠉⠉⠁⠀⠀⠀⠀⠀⠀⠀⠀

   ____  _   _   _    ____  _  __      _    ___ 
  / ___|| | | | / \  |  _ \| |/ /     / \  |_ _|
  \___ \| |_| |/ _ \ | |_) | ' /     / _ \  | | 
   ___) |  _  / ___ \|  _ <| . \    / ___ \ | | 
  |____/|_| |_/_/   \_\_| \_\_|\_\  /_/   \_\___|
                                                  
  AI-Native Autonomous & Collaborative Development Tool

```

**AI-Native Autonomous & Collaborative Development Tool**

*Agent-driven software engineering assistant with deterministic memory and terminal code orchestration*

[![npm version](https://img.shields.io/npm/v/shark-ai.svg)](https://www.npmjs.com/package/shark-ai)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen)](https://nodejs.org/)

**English** | [Português](./README.md)

</div>

---

## 🎯 What is Shark AI?

**Shark AI** is an open-source command-line software engineering assistant designed to operate directly inside your codebase as an autonomous pair-programmer.

Unlike generic chat assistants, Shark AI operates with a **rich TUI**, local semantic analysis tools (`ast-grep`, `ripgrep`), **parallel subagent orchestration**, session state persistence, and a **deterministic 3-layer memory architecture inspired by the Hermes Agent**, preserving Prompt Caching and eliminating heavy, brittle stochastic dependencies.

---

## ✨ Architectural Highlights

### 🧠 1. Deterministic 3-Layer Memory Architecture (Hermes Pattern)
No slow embeddings, no local vector databases. Shark AI implements a deterministic memory system:
- **`MemoryStore` (Flat Files & Strict Quotas)**:
  - Local `MEMORY.md` (`<workspace>/.shark/MEMORY.md`, max 2,200 chars) for project conventions and technical notes.
  - Global `USER.md` (`~/.shark/USER.md`, max 1,375 chars) for developer preferences and workflow style.
  - Global `SOUL.md` (`~/.shark/SOUL.md`, max 1,000 chars) **strictly read-only** to prevent prompt injections and persona drift.
  - **Capacity Meters & Self-Healing**: Structured headers `[XX% — Y/Z chars]` and error protocol providing `current_entries` on overflow, enabling the agent to consolidate stale entries using `replace`.
- **`StateDB` (Native SQLite FTS5)**:
  - Indexed local storage using Node 22 native `node:sqlite` with WAL mode and automatic triggers, delivering full-text session searches in **<10ms** via the `session_search` tool.
- **`ContextCompressor` (Tail Protection & Hybrid Summary)**:
  - Triggers at 80% token budget. Strictly protects Turn 0/1 (*Pinned*) and the last 15 conversation turns (*Tail Protection*), while preserving tool call / tool result pairing integrity.
- **Frozen Snapshot (Prompt Caching)**:
  - Memory files are loaded once during CLI boot and remain frozen in the active System Prompt, achieving **75% to 90% cost and latency savings** via Prompt Caching.

### 🤖 2. Developer Agent & Specialized Subagents
- **Interactive Developer Loop (`shark dev`)**: Full-featured interactive terminal environment with rich Markdown rendering, interactive diff viewer, command history, and slash shortcuts (`/auto`, `/chat`, etc.).
- **Concurrent Subagents**: The primary agent can dispatch background subagents to run tests, research documentation, or refactor components without blocking your active work.

### 🛠️ 3. Advanced Native Tooling
- Safe terminal execution with output streaming and capture.
- Surgical file manipulation, reading, and editing.
- Structural code searches via `ast-grep` and high-speed textual grep.
- Memory governance tools (`memory` and `session_search`).

### 🌐 4. Multi-Provider Flexibility
- **StackSpot AI**: Native integration with OAuth 2.0 PKCE, Workspaces, and corporate Knowledge Sources.
- **OpenAI-Compatible**: Seamless connection to OpenAI, DeepSeek, Anthropic (via proxy), Ollama, vLLM, LM Studio, or any OpenAI-compliant endpoint.

### ⚡ 5. Superpowers & Integrated Skills (`shark super`)
- Install and sync cutting-edge development skills: iterative brainstorming, systematic debugging, strict TDD, plan authoring, and subagent-driven development.

### 📊 6. Knowledge Graph Visualizer (`shark graph`)
- Extracts codebase entity and dependency graphs, generating interactive visual representations in HTML and Mermaid.

---

## 🚀 Installation

### Requirements
- **Node.js >= 22.0.0** (required for native `node:sqlite` support without C++ build dependencies).

### Global Installation (Stable Release)
```bash
npm install -g shark-ai
```

### Next-Gen Preview (@next)
```bash
npm install -g shark-ai@next
```

Or run on demand via `npx`:
```bash
npx shark-ai@next dev
```

---

## ⚡ Quick Start

### 1. Configure Provider

#### Using StackSpot AI:
```bash
shark login
```
*Your browser will open automatically for OAuth 2.0 PKCE authentication. Tokens are stored securely in your OS keychain.*

#### Using OpenAI or Compatible Endpoints:
```bash
shark config
```
*Select `openai_compatible`, provide your `apiKey`, `baseUrl` (e.g., `https://api.openai.com/v1` or `http://localhost:11434/v1`), and target `modelName`.*

---

### 2. Initialize Workspace
Inside your project root:
```bash
shark init
```
*Sets up the `.shark/` configuration structure and initializes local project memory files.*

---

### 3. Launch Development Mode
```bash
shark dev
```
Enter Shark Dev's interactive TUI:
- Instruct the agent to implement features, refactor code, or diagnose bugs.
- The agent inspects files, runs tests, inspects diffs, and guides execution.
- Project architectural notes are autonomously recorded in `MEMORY.md` and indexed in SQLite.

---

## 📚 CLI Commands

| Command | Description |
| :--- | :--- |
| `shark dev` | Launches the interactive autonomous developer agent loop. |
| `shark login` | Authenticates with StackSpot AI via OAuth 2.0 PKCE. |
| `shark init` | Initializes project `.shark/` configuration and memory templates. |
| `shark config` | Interactive assistant to configure providers (StackSpot / OpenAI) and API keys. |
| `shark super` | Installs and synchronizes the Superpowers agentic skills catalog. |
| `shark graph` | Generates an interactive HTML and Mermaid knowledge graph of your project. |
| `shark export-schema` | Exports the workflow and configuration JSON schemas. |
| `shark export-prompt` | Prints and exports system prompts for developer agent inspection. |

---

## 📂 Memory Layout

```
~/.shark/                          # Global Developer Scope
├── USER.md                        # Developer preferences and habits (max 1,375 chars)
└── SOUL.md                        # Agent identity and persona (max 1,000 chars, read-only)

<your-project>/.shark/             # Local Repository Scope
├── MEMORY.md                      # Project architectural notes & conventions (max 2,200 chars)
└── state.db                       # Native SQLite with FTS5 (session message history)
```

---

## 🔒 Governance & Security

- ✅ **Prompt Injection Defense**: `SOUL.md` is strictly read-only; memory inputs are sanitized against invisible Unicode characters and XML tag escapes.
- ✅ **Human Approval**: High-impact terminal commands require interactive user confirmation before execution.
- ✅ **Zero C++ Build Headaches**: Powered by Node 22's native `node:sqlite`, eliminating node-gyp / MSBuild build failures on all platforms.

---

## 📄 License

Distributed under the MIT License. See [LICENSE](./LICENSE) for details.

---

<div align="center">

**Engineered for real-world software development productivity**

If Shark AI accelerates your workflow, consider giving it a ⭐ on GitHub!

</div>
