# @btcp/code-mode

Plug-and-play library to enable agents to call BTCP tools via code execution.

Transform your AI agents from clunky tool callers into efficient code executors. Instead of making multiple individual tool calls, agents write TypeScript code that executes tool chains in a single request.

## Features

- **Extensible Architecture**: Code-mode is an extension to BTCPClient, allowing flexible composition
- **Code-based tool execution**: Execute TypeScript code that calls BTCP tools
- **Tool Discovery**: Automatically discover and wrap client tools for code execution
- **Exclusive Mode**: Optionally hide other tools, exposing only code-mode
- **VM sandbox isolation**: Secure code execution in isolated Node.js VM
- **Auto-generated interfaces**: TypeScript interfaces from tool schemas
- **Full BTCP protocol support**: Compatible with [BTCP specification](https://github.com/browser-tool-calling-protocol/btcp-specification)

## Installation

```bash
npm install @btcp/code-mode
```

## Quick Start

### Using BTCPClient with CodeModeExtension (Recommended)

```typescript
import { BTCPClient, createCodeModeExtension } from '@btcp/code-mode';

// Create client
const client = BTCPClient.create({
  serverUrl: 'http://localhost:8765',
  debug: true,
});

// Create and register code-mode extension
const codeMode = createCodeModeExtension({
  executionTimeout: 30000,
  exclusiveMode: true,  // Only expose code-mode tools
});

await client.use(codeMode);
await client.connect();

// Execute tool chain as code
const { result, logs } = await codeMode.callToolChain(`
  // Access discovered tools via the 'tools' namespace
  const data = await tools.getData({ id: 123 });
  const processed = await tools.processData({ input: data });
  return { success: true, result: processed };
`);

console.log(result);
```

### Registering Custom Tools

```typescript
import { BTCPClient, createCodeModeExtension } from '@btcp/code-mode';

const client = BTCPClient.create();
const codeMode = createCodeModeExtension();

// Register a custom tool with the client
client.registerTool(
  {
    name: 'calculateSum',
    description: 'Calculate the sum of two numbers',
    inputSchema: {
      type: 'object',
      properties: {
        a: { type: 'number' },
        b: { type: 'number' },
      },
      required: ['a', 'b'],
    },
  },
  async (args) => {
    return { sum: (args.a as number) + (args.b as number) };
  }
);

await client.use(codeMode);

// Tool is now available in code execution
const { result } = await codeMode.callToolChain(`
  const sum = await tools.calculateSum({ a: 5, b: 3 });
  return sum;
`);
// result = { sum: 8 }
```

### Tool Management

```typescript
// Disable specific tools
client.disableTool('sensitiveOperation');

// Disable all tools except specific ones
client.disableAllToolsExcept('callToolChain', 'searchTools');

// Re-enable all tools
client.enableAllTools();

// Check if a tool is disabled
const isDisabled = client.isToolDisabled('myTool');
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        BTCPClient                            │
│  ┌─────────────────────────────────────────────────────────┐│
│  │                  Tool Registry                           ││
│  │  - registerTool(definition, handler)                    ││
│  │  - disableTool(name) / enableTool(name)                 ││
│  │  - executeTool(name, args)                              ││
│  └─────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────┐│
│  │                  Extensions                              ││
│  │  ┌─────────────────────────────────────────────────────┐││
│  │  │              CodeModeExtension                       │││
│  │  │  - Registers callToolChain, searchTools, etc.       │││
│  │  │  - Discovers client tools                            │││
│  │  │  - Executes code in VM sandbox                       │││
│  │  └─────────────────────────────────────────────────────┘││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

## API Reference

### BTCPClient

The base client for BTCP connections with extensible tool management.

```typescript
const client = BTCPClient.create({
  serverUrl: 'http://localhost:8765',
  debug: false,
  autoReconnect: true,
});
```

#### Tool Management

```typescript
// Register a tool
client.registerTool(toolDefinition, handler);

// Get all tools (optionally including disabled)
const tools = client.getTools(includeDisabled);

// Disable/enable tools
client.disableTool('toolName');
client.enableTool('toolName');
client.disableAllToolsExcept('tool1', 'tool2');
client.enableAllTools();

// Execute a tool
const result = await client.executeTool('toolName', { arg: 'value' });
```

#### Extension System

```typescript
// Register an extension
await client.use(extension);

// Get an extension
const codeMode = client.getExtension<CodeModeExtension>('code-mode');
```

### CodeModeExtension

Extension that enables code-based tool execution.

```typescript
const codeMode = createCodeModeExtension({
  executionTimeout: 30000,    // Code execution timeout
  captureConsole: true,       // Capture console.log output
  memoryLimit: 128 * 1024 * 1024,  // VM memory limit
  toolsNamespace: 'tools',    // Namespace for discovered tools
  autoDiscoverTools: true,    // Auto-discover client tools
  exclusiveMode: false,       // Disable other tools when active
});
```

#### Code Execution

```typescript
const { result, logs } = await codeMode.callToolChain(`
  const data = await tools.fetchData({ id: 123 });
  console.log('Fetched:', data);
  return data;
`, 60000);  // Optional timeout override

console.log(result);  // Returned value
console.log(logs);    // Console output
```

#### Tool Discovery

```typescript
// Search for tools
const results = codeMode.searchTools('click button', 5);

// Get TypeScript interfaces
const interfaces = codeMode.getToolInterfaces('tools');

// Get compact summary for prompts
const summary = codeMode.getToolInterfaces(undefined, true);
```

#### Mode Control

```typescript
// Enable exclusive mode (only code-mode tools exposed to agents)
codeMode.enableExclusiveMode();

// Disable exclusive mode (all tools exposed)
codeMode.disableExclusiveMode();
```

### Registered Tools

When code-mode is registered, it provides these tools to agents:

| Tool | Description |
|------|-------------|
| `callToolChain` | Execute TypeScript code that calls multiple tools |
| `getToolInterfaces` | Get TypeScript interfaces for available tools |
| `searchTools` | Search for tools by name or description |

## Why Code Mode?

Traditional tool calling requires multiple round-trips:

```
Agent → Tool Call 1 → Result 1
Agent → Tool Call 2 → Result 2
Agent → Tool Call 3 → Result 3
```

Code mode executes everything in a single request:

```
Agent → callToolChain(code) → All Results
```

**Benefits:**
- **67-88% faster** than traditional tool calling
- **Reduced token usage** - one code block vs many tool calls
- **Better composability** - use variables, loops, conditionals
- **Type safety** - auto-generated TypeScript interfaces

## Sandbox Features

The code execution sandbox provides:

- **Console capture**: `console.log()`, `console.error()`, etc. are captured
- **Async/await support**: Full async execution
- **Standard globals**: JSON, Math, Date, String, Array, Object, etc.
- **Timeout protection**: Configurable execution limits
- **Introspection**: `__interfaces` and `__getToolInterface()` available

```typescript
const { result, logs } = await codeMode.callToolChain(`
  // Available namespaces
  console.log('Available:', __interfaces);

  // Get interface for a namespace
  const iface = __getToolInterface('tools');
  console.log(iface);

  // Use tools
  const data = await tools.getData({ id: 1 });
  return data;
`);
```

## Error Handling

```typescript
import {
  CodeExecutionError,
  TimeoutError,
  BTCPConnectionError
} from '@btcp/code-mode';

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

## Events

```typescript
client.on('connect', () => {
  console.log('Connected to BTCP server');
});

client.on('disconnect', (code, reason) => {
  console.log(`Disconnected: ${reason}`);
});

client.on('error', (error) => {
  console.error('Error:', error);
});

client.on('toolCall', (request) => {
  console.log('Tool called:', request.params.name);
});
```

## Legacy API

The `CodeModeBtcpClient` class is still available for backwards compatibility but is deprecated. Use `BTCPClient` with `CodeModeExtension` instead.

```typescript
// Legacy (deprecated)
import { CodeModeBtcpClient } from '@btcp/code-mode';
const client = await CodeModeBtcpClient.create({ serverUrl: '...' });

// Recommended
import { BTCPClient, createCodeModeExtension } from '@btcp/code-mode';
const client = BTCPClient.create({ serverUrl: '...' });
await client.use(createCodeModeExtension());
```

## License

MIT
