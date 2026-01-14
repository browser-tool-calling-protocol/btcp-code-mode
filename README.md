# @btcp/code-mode

Plug-and-play library to enable agents to call BTCP tools via code execution.

Transform your AI agents from clunky tool callers into efficient code executors. Instead of making multiple individual tool calls, agents write TypeScript code that executes tool chains in a single request.

## Features

- **Extension Architecture**: Code-mode registers as an extension to BTCPClient
- **Code-based tool execution**: Execute TypeScript code that calls BTCP tools
- **Tool Discovery**: Automatically discover and wrap client tools for code execution
- **Exclusive Mode**: Optionally hide other tools, exposing only code-mode
- **VM sandbox isolation**: Secure code execution in isolated Node.js VM
- **Auto-generated interfaces**: TypeScript interfaces from tool schemas

## Installation

```bash
npm install @btcp/code-mode
```

## Quick Start

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
  exclusiveMode: true,  // Only expose code-mode tools to agents
});

await client.use(codeMode);
await client.connect();

// Execute tool chain as code
const { result, logs } = await codeMode.callToolChain(`
  const data = await tools.getData({ id: 123 });
  const processed = await tools.processData({ input: data });
  return { success: true, result: processed };
`);

console.log(result);
```

## Registering Custom Tools

```typescript
import { BTCPClient, createCodeModeExtension } from '@btcp/code-mode';

const client = BTCPClient.create();

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

// Add code-mode extension (discovers client tools automatically)
const codeMode = createCodeModeExtension();
await client.use(codeMode);

// Tool is now available in code execution
const { result } = await codeMode.callToolChain(`
  const sum = await tools.calculateSum({ a: 5, b: 3 });
  return sum;
`);
// result = { sum: 8 }
```

## Tool Management

```typescript
// Disable specific tools (hidden from agents)
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
// Register a tool with handler
client.registerTool(toolDefinition, handler);

// Get all tools (optionally including disabled)
const tools = client.getTools(includeDisabled);

// Disable/enable tools
client.disableTool('toolName');
client.enableTool('toolName');
client.disableAllToolsExcept('tool1', 'tool2');
client.enableAllTools();

// Execute a tool locally
const result = await client.executeTool('toolName', { arg: 'value' });

// Call a tool on remote BTCP server
const result = await client.callRemoteTool('toolName', { arg: 'value' });
```

#### Extension System

```typescript
// Register an extension
await client.use(extension);

// Get an extension by name
const codeMode = client.getExtension<CodeModeExtension>('code-mode');
```

### CodeModeExtension

Extension that enables code-based tool execution.

```typescript
const codeMode = createCodeModeExtension({
  executionTimeout: 30000,         // Code execution timeout (ms)
  captureConsole: true,            // Capture console.log output
  memoryLimit: 128 * 1024 * 1024,  // VM memory limit
  toolsNamespace: 'tools',         // Namespace for discovered tools
  autoDiscoverTools: true,         // Auto-discover client tools
  exclusiveMode: false,            // Disable other tools when active
});
```

#### Registered Tools

When code-mode is registered, it provides these tools to agents:

| Tool | Description |
|------|-------------|
| `callToolChain` | Execute TypeScript code that calls multiple tools |
| `getToolInterfaces` | Get TypeScript interfaces for available tools |
| `searchTools` | Search for tools by name or description |

#### Code Execution

```typescript
const { result, logs } = await codeMode.callToolChain(`
  const data = await tools.fetchData({ id: 123 });
  console.log('Fetched:', data);
  return data;
`, 60000);  // Optional timeout override
```

#### Tool Discovery

```typescript
// Search for tools
const results = codeMode.searchTools('click button', 5);

// Get TypeScript interfaces
const interfaces = codeMode.getToolInterfaces('tools');

// Get compact summary for prompts
const summary = codeMode.getToolInterfaces(undefined, true);

// Register tools from a namespace manually
codeMode.registerToolsNamespace('custom', customTools);
```

#### Mode Control

```typescript
// Enable exclusive mode (only code-mode tools exposed to agents)
codeMode.enableExclusiveMode();

// Disable exclusive mode (all tools exposed)
codeMode.disableExclusiveMode();
```

### BTCPClientExtension Interface

Extensions implement this interface to integrate with BTCPClient:

```typescript
interface BTCPClientExtension {
  name: string;
  onRegister?(client: BTCPClient): void | Promise<void>;
  onConnect?(client: BTCPClient): void | Promise<void>;
  onDisconnect?(client: BTCPClient): void | Promise<void>;
  getTools?(): BTCPToolDefinition[];
  getHandlers?(): Map<string, ToolHandler>;
}
```

---

## Proposed Changes for @btcp/client

To enable code-mode as an extension, the `@btcp/client` package should implement the following:

### 1. Extension System

```typescript
// Add to BTCPClient class
interface BTCPClientExtension {
  name: string;
  onRegister?(client: BTCPClient): void | Promise<void>;
  onConnect?(client: BTCPClient): void | Promise<void>;
  onDisconnect?(client: BTCPClient): void | Promise<void>;
  getTools?(): BTCPToolDefinition[];
  getHandlers?(): Map<string, ToolHandler>;
}

class BTCPClient {
  private extensions: Map<string, BTCPClientExtension> = new Map();

  async use(extension: BTCPClientExtension): Promise<this> {
    // Register extension's tools and handlers
    const tools = extension.getTools?.() || [];
    const handlers = extension.getHandlers?.() || new Map();

    for (const tool of tools) {
      this.registerTool(tool);
    }
    for (const [name, handler] of handlers) {
      this.registerHandler(name, handler);
    }

    await extension.onRegister?.(this);
    this.extensions.set(extension.name, extension);
    return this;
  }

  getExtension<T extends BTCPClientExtension>(name: string): T | undefined {
    return this.extensions.get(name) as T;
  }
}
```

### 2. Tool Registry with Disable Support

```typescript
class BTCPClient {
  private registeredTools: Map<string, BTCPToolDefinition> = new Map();
  private toolHandlers: Map<string, ToolHandler> = new Map();
  private disabledTools: Set<string> = new Set();

  registerTool(tool: BTCPToolDefinition, handler?: ToolHandler): void {
    this.registeredTools.set(tool.name, tool);
    if (handler) {
      this.toolHandlers.set(tool.name, handler);
    }
  }

  registerHandler(name: string, handler: ToolHandler): void {
    this.toolHandlers.set(name, handler);
  }

  disableTool(name: string): void {
    this.disabledTools.add(name);
  }

  enableTool(name: string): void {
    this.disabledTools.delete(name);
  }

  disableAllToolsExcept(...names: string[]): void {
    const keep = new Set(names);
    for (const name of this.registeredTools.keys()) {
      if (!keep.has(name)) {
        this.disabledTools.add(name);
      }
    }
  }

  enableAllTools(): void {
    this.disabledTools.clear();
  }

  getTools(includeDisabled = false): BTCPToolDefinition[] {
    const tools: BTCPToolDefinition[] = [];
    for (const [name, tool] of this.registeredTools) {
      if (includeDisabled || !this.disabledTools.has(name)) {
        tools.push(tool);
      }
    }
    return tools;
  }

  // tools/list handler should use getTools(false) to respect disabled state
}
```

### 3. Tool Execution

```typescript
class BTCPClient {
  async executeTool(name: string, args: Record<string, unknown>): Promise<BTCPContent[]> {
    const handler = this.toolHandlers.get(name);
    if (!handler) {
      throw new Error(`No handler for tool: ${name}`);
    }
    const result = await handler(args);
    return normalizeContent(result);
  }

  // For calling tools on remote server
  async callRemoteTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const response = await this.sendRequest('tools/call', { name, arguments: args });
    // ... handle response
  }
}
```

### 4. Lifecycle Hooks

```typescript
class BTCPClient {
  async connect(): Promise<void> {
    // ... connection logic ...

    // Notify extensions
    for (const ext of this.extensions.values()) {
      await ext.onConnect?.(this);
    }
  }

  async disconnect(): Promise<void> {
    // Notify extensions
    for (const ext of this.extensions.values()) {
      await ext.onDisconnect?.(this);
    }

    // ... disconnection logic ...
  }
}
```

### Usage with Code-Mode

Once these changes are in `@btcp/client`:

```typescript
import { BTCPClient } from '@btcp/client';
import { createCodeModeExtension } from '@btcp/code-mode';

const client = new BTCPClient({ serverUrl: 'http://localhost:8765' });

// Register code-mode extension
const codeMode = createCodeModeExtension({ exclusiveMode: true });
await client.use(codeMode);

await client.connect();

// Agent now sees only: callToolChain, getToolInterfaces, searchTools
// Agent can execute code that calls all registered tools internally
```

---

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

## License

MIT
