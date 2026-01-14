# @btcp/code-mode

Plug-and-play library to enable agents to call BTCP tools via code execution.

Transform your AI agents from clunky tool callers into efficient code executors. Instead of making multiple individual tool calls, agents write TypeScript code that executes tool chains in a single request.

## Features

- **Zero client modifications**: Works with existing `@btcp/client` without changes
- **Tool provider pattern**: CodeMode registers as a tool to the client
- **Tools register with CodeMode**: Other tools register with CodeMode, not the client
- **Code-based execution**: Execute TypeScript code that calls multiple tools
- **VM sandbox isolation**: Secure code execution in isolated Node.js VM
- **Auto-generated interfaces**: TypeScript interfaces from tool schemas

## Installation

```bash
npm install @btcp/code-mode
```

## Quick Start

```typescript
import { BTCPClient } from '@btcp/client';
import { CodeMode } from '@btcp/code-mode';

// Create client and code-mode
const client = new BTCPClient({ serverUrl: 'http://localhost:8765' });
const codeMode = new CodeMode();

// Register tools WITH CODE-MODE (not client)
codeMode.registerTools('github', githubTools, async (name, args) => {
  // Your tool implementation
  return callGitHubAPI(name, args);
});

codeMode.registerTools('browser', browserTools, async (name, args) => {
  return callBrowserAPI(name, args);
});

// Install code-mode tools TO client
codeMode.install(client);

// Connect
await client.connect();

// Agent now sees: callToolChain, getToolInterfaces, searchTools
// Inside callToolChain, agent can use: github.*, browser.*
```

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                         Agent                                    │
│  Only sees: callToolChain, getToolInterfaces, searchTools       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                       BTCPClient                                 │
│  Has registered: callToolChain, getToolInterfaces, searchTools  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        CodeMode                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  Registered Tools (available inside code execution):        ││
│  │  - github.getRepo(), github.listIssues(), ...               ││
│  │  - browser.click(), browser.fill(), ...                     ││
│  └─────────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  VM Sandbox executes code with access to all tools          ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

## API Reference

### CodeMode

```typescript
const codeMode = new CodeMode({
  executionTimeout: 30000,         // Code execution timeout (ms)
  captureConsole: true,            // Capture console.log output
  memoryLimit: 128 * 1024 * 1024,  // VM memory limit
  debug: false,                    // Debug logging
});
```

#### `registerTools(namespace, tools, callTool)`

Register a namespace of tools with CodeMode.

```typescript
codeMode.registerTools(
  'github',  // Namespace - tools accessible as github.toolName()
  [
    {
      name: 'getRepo',
      description: 'Get repository info',
      inputSchema: { type: 'object', properties: { owner: { type: 'string' }, repo: { type: 'string' } }, required: ['owner', 'repo'] }
    },
    // ... more tools
  ],
  async (toolName, args) => {
    // Called when code executes github.getRepo(), etc.
    return yourApiCall(toolName, args);
  }
);
```

#### `registerTool(namespace, tool, handler)`

Register a single tool.

```typescript
codeMode.registerTool(
  'utils',
  {
    name: 'calculateSum',
    description: 'Add two numbers',
    inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] }
  },
  async (args) => ({ sum: args.a + args.b })
);
```

#### `install(client)`

Install CodeMode tools to a BTCP client.

```typescript
codeMode.install(client);
// Client now has: callToolChain, getToolInterfaces, searchTools
```

#### `callToolChain(code, timeout?)`

Execute code directly (for testing or non-client usage).

```typescript
const { result, logs } = await codeMode.callToolChain(`
  const repo = await github.getRepo({ owner: 'microsoft', repo: 'vscode' });
  return repo.stargazers_count;
`);
```

#### `getToolInterfaces(namespace?, compact?)`

Get TypeScript interfaces for tools.

```typescript
// Full interfaces
const interfaces = codeMode.getToolInterfaces();

// Compact summary
const summary = codeMode.getToolInterfaces(undefined, true);

// Specific namespace
const githubInterfaces = codeMode.getToolInterfaces('github');
```

#### `searchTools(query, limit?)`

Search for tools.

```typescript
const results = codeMode.searchTools('repository', 5);
// [{ namespace: 'github', tool: {...}, score: 75 }, ...]
```

### Tools Provided to Agent

When installed, CodeMode provides these tools to the agent:

| Tool | Description |
|------|-------------|
| `callToolChain` | Execute TypeScript code that calls registered tools |
| `getToolInterfaces` | Get TypeScript interfaces for available tools |
| `searchTools` | Search for tools by name or description |

### callToolChain Input Schema

```typescript
{
  code: string,     // Required: TypeScript code to execute
  timeout?: number  // Optional: execution timeout in ms
}
```

### Code Execution Context

Inside `callToolChain`, code has access to:

- All registered namespaces (e.g., `github`, `browser`)
- `console.log()`, `console.error()` (captured in logs)
- Standard JS globals: `JSON`, `Math`, `Date`, `Array`, etc.
- `__interfaces`: Array of available namespace names
- `__getToolInterface(namespace)`: Get interface for a namespace

```typescript
// Example code execution
const { result, logs } = await codeMode.callToolChain(`
  // See available namespaces
  console.log('Available:', __interfaces);

  // Call tools
  const repo = await github.getRepo({ owner: 'facebook', repo: 'react' });
  const issues = await github.listIssues({ owner: 'facebook', repo: 'react', state: 'open' });

  // Process and return
  return {
    name: repo.full_name,
    stars: repo.stargazers_count,
    openIssues: issues.length
  };
`);
```

## Why Code Mode?

Traditional tool calling:
```
Agent → github.getRepo() → Result
Agent → github.listIssues() → Result
Agent → browser.click() → Result
Agent → browser.fill() → Result
(4 round trips)
```

Code mode:
```
Agent → callToolChain(`
  const repo = await github.getRepo(...);
  const issues = await github.listIssues(...);
  await browser.click(...);
  await browser.fill(...);
  return { repo, issues };
`) → All Results
(1 round trip)
```

**Benefits:**
- **67-88% faster** than traditional tool calling
- **Reduced token usage** - one code block vs many tool calls
- **Better composability** - use variables, loops, conditionals
- **Type safety** - auto-generated TypeScript interfaces

## Complete Example

```typescript
import { BTCPClient } from '@btcp/client';
import { CodeMode } from '@btcp/code-mode';

// Create instances
const client = new BTCPClient({ serverUrl: 'http://localhost:8765' });
const codeMode = new CodeMode({ debug: true });

// Define tools
const githubTools = [
  {
    name: 'getRepo',
    description: 'Get repository information',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repository owner' },
        repo: { type: 'string', description: 'Repository name' }
      },
      required: ['owner', 'repo']
    }
  },
  {
    name: 'listIssues',
    description: 'List repository issues',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string' },
        repo: { type: 'string' },
        state: { type: 'string', enum: ['open', 'closed', 'all'] }
      },
      required: ['owner', 'repo']
    }
  }
];

// Register with code-mode
codeMode.registerTools('github', githubTools, async (name, args) => {
  const response = await fetch(`https://api.github.com/repos/${args.owner}/${args.repo}${name === 'listIssues' ? '/issues' : ''}`);
  return response.json();
});

// Install to client
codeMode.install(client);

// Connect
await client.connect();

// Now agent can call:
// - callToolChain({ code: "const repo = await github.getRepo({...}); return repo;" })
// - getToolInterfaces({ namespace: "github" })
// - searchTools({ query: "repository" })
```

## Error Handling

```typescript
import { CodeExecutionError, TimeoutError } from '@btcp/code-mode';

try {
  const { result } = await codeMode.callToolChain(`
    throw new Error('Something went wrong');
  `);
} catch (error) {
  if (error instanceof TimeoutError) {
    console.log('Execution timed out');
  } else if (error instanceof CodeExecutionError) {
    console.log('Code execution failed:', error.message);
  }
}
```

## Sandbox Features

The code execution sandbox provides:

- **Console capture**: `console.log()`, `console.error()`, etc. are captured
- **Async/await support**: Full async execution
- **Standard globals**: JSON, Math, Date, String, Array, Object, etc.
- **Timeout protection**: Configurable execution limits
- **Introspection**: `__interfaces` and `__getToolInterface()` available

## License

MIT
