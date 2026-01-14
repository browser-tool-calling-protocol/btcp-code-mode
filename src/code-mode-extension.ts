/**
 * Code Mode Extension
 * Extension for BTCPClient that enables code-based tool execution
 */

import { BTCPClient, BTCPClientExtension } from './btcp-client.js';
import { Sandbox, createSandbox, SandboxOptions } from './sandbox.js';
import {
  generateNamespaceInterface,
  generateCompactInterface,
} from './interface-generator.js';
import {
  BTCPToolDefinition,
  ToolHandler,
  ToolChainResult,
  ToolSearchResult,
} from './types.js';

/**
 * Code Mode Extension configuration
 */
export interface CodeModeExtensionConfig {
  /** Timeout for code execution in milliseconds */
  executionTimeout?: number;
  /** Enable console log capture */
  captureConsole?: boolean;
  /** Memory limit for VM (in bytes) */
  memoryLimit?: number;
  /** Namespace for discovered tools */
  toolsNamespace?: string;
  /** Automatically discover and register client tools */
  autoDiscoverTools?: boolean;
  /** Disable all other tools when code-mode is active */
  exclusiveMode?: boolean;
}

const DEFAULT_CONFIG: Required<CodeModeExtensionConfig> = {
  executionTimeout: 30000,
  captureConsole: true,
  memoryLimit: 128 * 1024 * 1024,
  toolsNamespace: 'tools',
  autoDiscoverTools: true,
  exclusiveMode: false,
};

/**
 * CodeModeExtension - Enables code-based tool execution for BTCPClient
 *
 * This extension registers a `callToolChain` tool that allows agents to
 * execute TypeScript code that calls other registered tools.
 */
export class CodeModeExtension implements BTCPClientExtension {
  readonly name = 'code-mode';

  private config: Required<CodeModeExtensionConfig>;
  private sandbox: Sandbox;
  private client: BTCPClient | null = null;
  private discoveredTools: Map<string, BTCPToolDefinition[]> = new Map();
  private toolInterfaces: Map<string, string> = new Map();

  constructor(config: CodeModeExtensionConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.sandbox = createSandbox({
      timeout: this.config.executionTimeout,
      captureConsole: this.config.captureConsole,
      memoryLimit: this.config.memoryLimit,
    });
  }

  /**
   * Get the sandbox instance
   */
  getSandbox(): Sandbox {
    return this.sandbox;
  }

  /**
   * Get the client instance
   */
  getClient(): BTCPClient | null {
    return this.client;
  }

  /**
   * Called when extension is registered with client
   */
  async onRegister(client: BTCPClient): Promise<void> {
    this.client = client;

    // If auto-discover is enabled, discover tools on connect
    if (this.config.autoDiscoverTools) {
      this.discoverClientTools();
    }

    // If exclusive mode, disable all other tools
    if (this.config.exclusiveMode) {
      client.disableAllToolsExcept('callToolChain');
    }
  }

  /**
   * Called when client connects
   */
  async onConnect(client: BTCPClient): Promise<void> {
    // Re-discover tools on reconnect
    if (this.config.autoDiscoverTools) {
      this.discoverClientTools();
    }
  }

  /**
   * Called when client disconnects
   */
  async onDisconnect(_client: BTCPClient): Promise<void> {
    // Could clear discovered tools here if needed
  }

  /**
   * Get tools provided by this extension
   */
  getTools(): BTCPToolDefinition[] {
    return [
      {
        name: 'callToolChain',
        description:
          'Execute TypeScript code that can call multiple tools in sequence. ' +
          'The code has access to all registered tool namespaces and can use async/await. ' +
          'Use this for complex operations that require multiple tool calls.',
        inputSchema: {
          type: 'object',
          properties: {
            code: {
              type: 'string',
              description:
                'TypeScript code to execute. Can use await and access tool namespaces. ' +
                'Must return a value using the return statement.',
            },
            timeout: {
              type: 'number',
              description:
                'Optional execution timeout in milliseconds. Defaults to configured timeout.',
            },
          },
          required: ['code'],
        },
        examples: [
          {
            name: 'Simple tool chain',
            input: {
              code: `
const result1 = await tools.firstTool({ input: "test" });
const result2 = await tools.secondTool({ data: result1 });
return result2;
`,
            },
          },
          {
            name: 'With error handling',
            input: {
              code: `
try {
  const data = await tools.fetchData({ id: 123 });
  return { success: true, data };
} catch (error) {
  console.error("Failed:", error.message);
  return { success: false, error: error.message };
}
`,
            },
          },
        ],
        tags: ['code-mode', 'tool-chain', 'execution'],
      },
      {
        name: 'getToolInterfaces',
        description:
          'Get TypeScript interface definitions for all available tools. ' +
          'Useful for understanding tool schemas before writing code.',
        inputSchema: {
          type: 'object',
          properties: {
            namespace: {
              type: 'string',
              description:
                'Optional namespace to get interfaces for. If not provided, returns all interfaces.',
            },
            compact: {
              type: 'boolean',
              description:
                'If true, returns a compact summary suitable for prompts. Default: false',
            },
          },
        },
        tags: ['code-mode', 'discovery', 'interfaces'],
      },
      {
        name: 'searchTools',
        description:
          'Search for tools by name or description. ' +
          'Useful for discovering available tools.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query to match against tool names and descriptions.',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of results to return. Default: 10',
            },
          },
          required: ['query'],
        },
        tags: ['code-mode', 'discovery', 'search'],
      },
    ];
  }

  /**
   * Get handlers for extension tools
   */
  getHandlers(): Map<string, ToolHandler> {
    const handlers = new Map<string, ToolHandler>();

    handlers.set('callToolChain', async (args) => {
      const code = args.code as string;
      const timeout = args.timeout as number | undefined;
      return this.callToolChain(code, timeout);
    });

    handlers.set('getToolInterfaces', async (args) => {
      const namespace = args.namespace as string | undefined;
      const compact = args.compact as boolean | undefined;
      return this.getToolInterfaces(namespace, compact);
    });

    handlers.set('searchTools', async (args) => {
      const query = args.query as string;
      const limit = args.limit as number | undefined;
      return this.searchTools(query, limit);
    });

    return handlers;
  }

  // ===========================================================================
  // Tool Discovery
  // ===========================================================================

  /**
   * Discover and register tools from the client
   */
  discoverClientTools(): void {
    if (!this.client) {
      return;
    }

    const tools = this.client.getTools(true); // Include disabled tools for discovery
    this.registerToolsNamespace(this.config.toolsNamespace, tools);
  }

  /**
   * Register a namespace of tools for code execution
   */
  registerToolsNamespace(namespace: string, tools: BTCPToolDefinition[]): void {
    this.discoveredTools.set(namespace, tools);

    // Create tool wrappers for the sandbox
    const wrappers = this.createToolWrappers(namespace, tools);

    // Generate interface
    const interfaceDefinition = generateNamespaceInterface(namespace, tools);
    this.toolInterfaces.set(namespace, interfaceDefinition);

    // Register with sandbox
    this.sandbox.registerNamespace(namespace, wrappers, interfaceDefinition);

    this.client?.log(
      `Code-mode: Registered namespace '${namespace}' with ${tools.length} tools`
    );
  }

  /**
   * Register tools from a remote BTCP server
   */
  async registerRemoteTools(
    namespace: string,
    serverUrl?: string
  ): Promise<void> {
    if (!this.client) {
      throw new Error('Extension not registered with a client');
    }

    // If different server, we'd need to create a separate connection
    // For now, use the client's connection
    const tools = await this.client.fetchRemoteTools();
    this.registerToolsNamespace(namespace, tools);
  }

  /**
   * Create tool wrapper functions for sandbox execution
   */
  private createToolWrappers(
    namespace: string,
    tools: BTCPToolDefinition[]
  ): Map<string, (args: Record<string, unknown>) => Promise<unknown>> {
    const wrappers = new Map<
      string,
      (args: Record<string, unknown>) => Promise<unknown>
    >();

    for (const tool of tools) {
      wrappers.set(tool.name, async (args: Record<string, unknown>) => {
        if (!this.client) {
          throw new Error('Client not available');
        }

        // Try local handler first, then remote
        if (this.client.hasHandler(tool.name)) {
          const result = await this.client.executeTool(tool.name, args);
          // Normalize result for sandbox
          if (result.length === 1 && result[0].type === 'text') {
            const text = result[0].text || '';
            try {
              return JSON.parse(text);
            } catch {
              return text;
            }
          }
          return result;
        } else {
          return this.client.callRemoteTool(tool.name, args);
        }
      });
    }

    return wrappers;
  }

  // ===========================================================================
  // Code Execution
  // ===========================================================================

  /**
   * Execute a tool chain as code
   */
  async callToolChain(code: string, timeout?: number): Promise<ToolChainResult> {
    // Re-discover tools to ensure we have the latest
    if (this.config.autoDiscoverTools) {
      this.discoverClientTools();
    }

    const result = await this.sandbox.execute(code, timeout);

    return {
      result: result.result,
      logs: [...result.logs, ...result.errors],
    };
  }

  /**
   * Get tool interfaces
   */
  getToolInterfaces(namespace?: string, compact?: boolean): string {
    if (namespace) {
      const tools = this.discoveredTools.get(namespace);
      if (!tools) {
        return `Namespace '${namespace}' not found`;
      }
      if (compact) {
        return generateCompactInterface(namespace, tools);
      }
      return this.toolInterfaces.get(namespace) || '';
    }

    // Return all interfaces
    if (compact) {
      const summaries: string[] = [];
      for (const [ns, tools] of this.discoveredTools) {
        summaries.push(generateCompactInterface(ns, tools));
      }
      return summaries.join('\n\n');
    }

    const interfaces: string[] = [];
    for (const iface of this.toolInterfaces.values()) {
      interfaces.push(iface);
    }
    return interfaces.join('\n\n');
  }

  /**
   * Search for tools across all namespaces
   */
  searchTools(query: string, limit: number = 10): ToolSearchResult[] {
    const results: ToolSearchResult[] = [];
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/);

    for (const [namespace, tools] of this.discoveredTools) {
      for (const tool of tools) {
        const nameLower = tool.name.toLowerCase();
        const descLower = tool.description.toLowerCase();

        // Calculate relevance score
        let score = 0;

        // Exact name match
        if (nameLower === queryLower) {
          score += 100;
        }

        // Name contains query
        if (nameLower.includes(queryLower)) {
          score += 50;
        }

        // Description contains query
        if (descLower.includes(queryLower)) {
          score += 25;
        }

        // Word matches
        for (const word of queryWords) {
          if (nameLower.includes(word)) {
            score += 10;
          }
          if (descLower.includes(word)) {
            score += 5;
          }
        }

        // Tag matches
        if (tool.tags) {
          for (const tag of tool.tags) {
            if (tag.toLowerCase().includes(queryLower)) {
              score += 15;
            }
          }
        }

        if (score > 0) {
          results.push({ namespace, tool, score });
        }
      }
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);

    return results.slice(0, limit);
  }

  /**
   * Get all discovered tools
   */
  getAllTools(): Map<string, BTCPToolDefinition[]> {
    return new Map(this.discoveredTools);
  }

  /**
   * Get namespaces available in sandbox
   */
  getNamespaces(): string[] {
    return this.sandbox.getNamespaces();
  }

  /**
   * Enable exclusive mode (disable all other tools)
   */
  enableExclusiveMode(): void {
    this.config.exclusiveMode = true;
    if (this.client) {
      this.client.disableAllToolsExcept('callToolChain', 'getToolInterfaces', 'searchTools');
    }
  }

  /**
   * Disable exclusive mode (re-enable all tools)
   */
  disableExclusiveMode(): void {
    this.config.exclusiveMode = false;
    if (this.client) {
      this.client.enableAllTools();
    }
  }
}

/**
 * Create a code mode extension
 */
export function createCodeModeExtension(
  config?: CodeModeExtensionConfig
): CodeModeExtension {
  return new CodeModeExtension(config);
}
