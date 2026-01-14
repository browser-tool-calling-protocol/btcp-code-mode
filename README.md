# @btcp/code-mode

Plug-and-play library to enable agents to call BTCP tools via code execution.

Transform your AI agents from clunky tool callers into efficient code executors. Instead of making multiple individual tool calls, agents write TypeScript code that executes tool chains in a single request.

## Features

- **Code-based tool execution**: Execute TypeScript code that calls BTCP tools
- **Automatic interface generation**: TypeScript interfaces auto-generated from tool schemas
- **VM sandbox isolation**: Secure code execution in isolated Node.js VM
- **Multi-source support**: Register tools from multiple BTCP servers
- **Tool search**: Discover tools dynamically to reduce context window load
- **Full BTCP protocol support**: Compatible with [BTCP specification](https://github.com/browser-tool-calling-protocol/btcp-specification)

## Installation

```bash
npm install @btcp/code-mode
```

## Quick Start

```typescript
import { CodeModeBtcpClient } from '@btcp/code-mode';

// Create client
const client = await CodeModeBtcpClient.create({
  serverUrl: 'http://localhost:8765',
  debug: true,
});

// Connect and register BTCP tools
await client.connect();
await client.registerBtcp({ name: 'browser' });

// Execute tool chain as code
const { result, logs } = await client.callToolChain(`
  // Click a button and fill a form
  await browser.browser_click({ selector: '#login-btn' });
  await browser.browser_fill({ selector: '#username', value: 'user@example.com' });
  await browser.browser_fill({ selector: '#password', value: 'secret123' });
  await browser.browser_click({ selector: '#submit' });

  // Get the result
  const pageTitle = await browser.browser_get_title({});
  return { success: true, title: pageTitle };
`);

console.log(result); // { success: true, title: 'Dashboard' }
```

## Why Code Mode?

Traditional tool calling requires multiple round-trips:

```
Agent → Tool Call 1 → Result 1
Agent → Tool Call 2 → Result 2
Agent → Tool Call 3 → Result 3
...
```

Code mode executes everything in a single request:

```
Agent → Code Block → All Results
```

**Benefits:**
- **67-88% faster** than traditional tool calling
- **Reduced token usage** - one code block vs many tool calls
- **Better composability** - use variables, loops, conditionals
- **Type safety** - auto-generated TypeScript interfaces

## API Reference

### CodeModeBtcpClient

#### `create(config?)`

Create a new client instance.

```typescript
const client = await CodeModeBtcpClient.create({
  serverUrl: 'http://localhost:8765',  // BTCP server URL
  sessionId: 'my-session',             // Optional session ID
  debug: false,                        // Enable debug logging
  executionTimeout: 30000,             // Code execution timeout (ms)
  autoReconnect: true,                 // Auto-reconnect on disconnect
  maxReconnectAttempts: 5,             // Max reconnection attempts
});
```

#### `connect()`

Connect to the BTCP server.

```typescript
await client.connect();
```

#### `registerBtcp(config)`

Register a BTCP tool source.

```typescript
await client.registerBtcp({
  name: 'browser',         // Namespace for tools
  serverUrl: 'http://...',  // Optional: different server URL
});
```

#### `registerManual(config)`

Register tools manually without connecting to a server.

```typescript
client.registerManual({
  name: 'custom',
  tools: [
    {
      name: 'my_tool',
      description: 'Does something useful',
      inputSchema: {
        type: 'object',
        properties: {
          input: { type: 'string' }
        },
        required: ['input']
      }
    }
  ],
  callTool: async (name, args) => {
    // Your tool implementation
    return { result: 'done' };
  }
});
```

#### `callToolChain(code, timeout?)`

Execute TypeScript code with registered tools.

```typescript
const { result, logs } = await client.callToolChain(`
  const data = await myNamespace.get_data({ id: 123 });
  const processed = await myNamespace.process(data);
  return processed;
`, 60000);  // Optional timeout override

console.log(result);  // Returned value
console.log(logs);    // Console output captured during execution
```

#### `searchTools(query, limit?)`

Search for tools across all registered sources.

```typescript
const results = client.searchTools('click button', 5);
// [
//   { namespace: 'browser', tool: { name: 'browser_click', ... }, score: 75 },
//   ...
// ]
```

#### `getToolInterface(namespace)`

Get TypeScript interface for a namespace.

```typescript
const interfaces = client.getToolInterface('browser');
console.log(interfaces);
// declare namespace browser {
//   interface BrowserClickInput { selector: string; }
//   function browser_click(input: BrowserClickInput): Promise<unknown>;
//   ...
// }
```

#### `getCompactToolSummary()`

Get a compact summary of all tools for prompts.

```typescript
const summary = client.getCompactToolSummary();
// browser.browser_click({ selector: string }) - Click an element
// browser.browser_fill({ selector: string, value: string }) - Fill input field
// ...
```

### Sandbox Features

The code execution sandbox provides:

- **Console capture**: `console.log()`, `console.error()`, etc. are captured
- **Async/await support**: Full async execution
- **Standard globals**: JSON, Math, Date, String, Array, Object, etc.
- **Timeout protection**: Configurable execution limits
- **Introspection**: `__interfaces` and `__getToolInterface()` available

```typescript
const { result, logs } = await client.callToolChain(`
  // Available namespaces
  console.log('Available:', __interfaces);

  // Get interface for a namespace
  const iface = __getToolInterface('browser');
  console.log(iface);

  // Use tools
  const title = await browser.browser_get_title({});
  console.log('Title:', title);

  return title;
`);

console.log(logs);  // All console output
```

## Error Handling

```typescript
import {
  CodeExecutionError,
  TimeoutError,
  BTCPConnectionError
} from '@btcp/code-mode';

try {
  const { result } = await client.callToolChain(`
    throw new Error('Something went wrong');
  `);
} catch (error) {
  if (error instanceof TimeoutError) {
    console.log('Execution timed out');
  } else if (error instanceof CodeExecutionError) {
    console.log('Code execution failed:', error.message);
  } else if (error instanceof BTCPConnectionError) {
    console.log('Connection error:', error.message);
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

## Integration with BTCP Client

This library is designed to work with [@btcp/client](https://github.com/browser-tool-calling-protocol/btcp-client) browser extensions that provide tools.

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   AI Agent      │     │   BTCP Server    │     │  Browser Client │
│  (code-mode)    │────▶│   (relay)        │────▶│  (@btcp/client) │
│                 │◀────│                  │◀────│                 │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

## TypeScript Support

Full TypeScript support with auto-generated interfaces:

```typescript
import {
  CodeModeBtcpClient,
  BTCPToolDefinition,
  ToolChainResult,
  CodeModeConfig
} from '@btcp/code-mode';

const config: CodeModeConfig = {
  serverUrl: 'http://localhost:8765',
  executionTimeout: 60000,
};

const client = await CodeModeBtcpClient.create(config);
```

## License

MIT
