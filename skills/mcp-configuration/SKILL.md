---
name: mcp-configuration
description: Use when the user asks to add, configure, update, list, or troubleshoot Model Context Protocol (MCP) servers and tools in Shark AI (.sharkrc).
---

# MCP Configuration in Shark AI

This skill guides Shark Dev on how to add, inspect, update, and troubleshoot Model Context Protocol (MCP) servers in Shark AI configuration files (`.sharkrc`).

## Architecture & How MCP Works in Shark Dev

1. **Native MCP Support**: Shark AI includes a built-in `McpManager` supporting standard stdio-based MCP servers.
2. **Server Initialization**: On startup, Shark Dev reads `.sharkrc` and connects to all active servers configured under `"mcpServers"`.
3. **Tool Discovery**:
   - Every tool provided by an MCP server is automatically registered in Shark Dev's tool catalog.
   - Tools are namespaced as `mcp_<serverName>_<toolOriginalName>` (e.g., `mcp_chrome-devtools_click` or `mcp_sqlite_read_query`).
4. **Progressive Disclosure Execution**:
   - Shark Dev finds MCP tools using `tool_search` (with queries matching the action or domain).
   - Details and parameter schemas are retrieved on demand using `tool_describe`.
   - Tools are executed using `tool_call` with arguments.

---

## Configuration Scopes: Global vs Local `.sharkrc`

Shark AI supports two configuration scopes. Local settings override global settings:

| Scope | Location | When to Use |
|---|---|---|
| **Global** | `~/.sharkrc`<br>(`%USERPROFILE%\.sharkrc` on Windows, `$HOME/.sharkrc` on Linux/macOS) | **Universal developer tools** useful in any project: `chrome-devtools`, GitHub integration, system clipboard, general search/fetch MCPs. |
| **Local** | `./.sharkrc`<br>(Project root directory) | **Project-specific tools**: Local project database (SQLite/PostgreSQL), workspace-specific CLI bridges, custom project mocks. |

> [!TIP]
> If the user does not specify whether to configure globally or locally:
> - Default to **Global (`~/.sharkrc`)** for general developer tooling (like browser debugging, GitHub, global utilities).
> - Default to **Local (`./.sharkrc`)** if the MCP references local files, project paths, or repository-specific databases.
> - Or ask the user explicitly if ambiguous.

---

## JSON Schema of `mcpServers`

In `.sharkrc`, MCP servers must be defined under the `"mcpServers"` object:

```json
{
  "mcpServers": {
    "<server-name>": {
      "command": "<executable>",
      "args": [
        "<arg1>",
        "<arg2>"
      ],
      "env": {
        "<VAR_NAME>": "<value>"
      },
      "cwd": "<optional-working-directory>"
    }
  }
}
```

### Field Definitions

- **`<server-name>`** (*string*, required): Unique identifier for the server (kebab-case or snake_case recommended, e.g. `"chrome-devtools"`, `"sqlite"`, `"github"`).
- **`command`** (*string*, required): The executable to run:
  - Node/NPM: `"npx"` or `"node"`
  - Python: `"uvx"` or `"python"`
  - Containers / Binaries: `"docker"` or direct binary path
- **`args`** (*string[]*, optional): Arguments passed to the command. E.g. `["-y", "chrome-devtools-mcp@latest", "--no-usage-statistics"]`.
- **`env`** (*Record<string, string>*, optional): Environment variables passed to the server process (e.g. API keys, access tokens, credentials).
- **`cwd`** (*string*, optional): Working directory from which the MCP server process will be launched.

---

## Step-by-Step Procedure for Shark Dev

When instructed by the user to add or modify an MCP server, Shark Dev MUST follow these steps:

### Step 1: Determine the Target Path
- For Global: Resolve `os.homedir() + '/.sharkrc'` (or `%USERPROFILE%\.sharkrc` on Windows).
- For Local: Resolve `./.sharkrc` in the current workspace root.

### Step 2: Read and Inspect the Existing `.sharkrc`
- Always use `read_file` to inspect the target file first.
- If the file does not exist, start with an empty JSON object: `{ "mcpServers": {} }`.
- If the file exists, parse the existing JSON content.

### Step 3: Preserve Existing Configuration
> [!IMPORTANT]
> **NEVER** overwrite or wipe existing properties in `.sharkrc`!
> Settings like `logLevel`, `language`, `provider`, `openai-compatible`, `stackspot`, `validation`, `memory`, and existing servers in `mcpServers` MUST be strictly preserved.

### Step 4: Add or Update the Server Entry
- Ensure `mcpServers` exists as an object: `config.mcpServers = config.mcpServers || {};`.
- Set or update `config.mcpServers[serverName] = { command, args, ... }`.

### Step 5: Save with Clean Formatting
- Serialize the configuration using 2-space indentation (`JSON.stringify(config, null, 2)`).
- Write to the target file using `create_file` (or `modify_file`).

### Step 6: Notify the User & Explain Restart Requirement
- Confirm to the user which server and parameters were configured and in which file (`~/.sharkrc` or `./.sharkrc`).
- **CRITICAL NOTICE**: Inform the user that Shark Dev loads MCP servers upon session startup. For the new MCP server and its tools to be loaded and recognized, they must restart `shark dev` (or start a new session).
- **Security Notice**: If the user provided sensitive API tokens in a **local** `./.sharkrc`, remind them to add `.sharkrc` to `.gitignore` so secrets are not committed to source control.

---

## Common MCP Presets & Examples

### 1. Chrome DevTools (Browser Automation & Inspection)
```json
"chrome-devtools": {
  "command": "npx",
  "args": [
    "-y",
    "chrome-devtools-mcp@latest",
    "--no-usage-statistics",
    "--no-performance-crux"
  ]
}
```

### 2. Filesystem (Directory & File Operations)
```json
"filesystem": {
  "command": "npx",
  "args": [
    "-y",
    "@modelcontextprotocol/server-filesystem",
    "./"
  ]
}
```

### 3. SQLite Database
```json
"sqlite": {
  "command": "npx",
  "args": [
    "-y",
    "@modelcontextprotocol/server-sqlite",
    "--db-path",
    "./data/database.sqlite"
  ]
}
```

### 4. GitHub (Issues, PRs, Repositories)
```json
"github": {
  "command": "npx",
  "args": [
    "-y",
    "@modelcontextprotocol/server-github"
  ],
  "env": {
    "GITHUB_PERSONAL_ACCESS_TOKEN": "<token>"
  }
}
```

### 5. PostgreSQL Database
```json
"postgres": {
  "command": "npx",
  "args": [
    "-y",
    "@modelcontextprotocol/server-postgres",
    "postgresql://user:password@localhost:5432/dbname"
  ]
}
```

### 6. Python / UVX-based MCP (e.g. Git or Fetch)
```json
"git": {
  "command": "uvx",
  "args": [
    "mcp-server-git"
  ]
}
```

---

## Verification & Troubleshooting Checklist

- **Valid JSON**: Ensure there are no trailing commas or syntax errors in `.sharkrc`.
- **Path formatting on Windows**: Use forward slashes `/` or double backslashes `\\` for file paths in `args`.
- **Missing Executables**: Verify that `npx` or `uvx` is installed and available in the system PATH.
- **Tools Verification**: Once `shark dev` is restarted, the agent can run `tool_search` with queries like `"mcp"` or the server name to verify tool discovery.
