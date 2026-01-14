/**
 * CodeMode - Tool provider for code-based tool execution
 *
 * CodeMode is a standalone tool provider that registers with any BTCP client.
 * Other tools register with CodeMode (not the client) and become available
 * inside code execution.
 */

import { Sandbox, createSandbox } from './sandbox.js';
import {
  generateNamespaceInterface,
  generateCompactInterface,
} from './interface-generator.js';
import {
  BTCPToolDefinition,
  BTCPContent,
  ToolChainResult,
  ToolSearchResult,
} from './types.js';
import { createTextContent } from './protocol.js';

/**
 * Tool caller function type
 */
export type ToolCaller = (
  toolName: string,
  args: Record<string, unknown>
) => Promise<unknown>;

/**
 * Registered tool source
 */
export interface ToolSource {
  name: string;
  tools: BTCPToolDefinition[];
  callTool: ToolCaller;
}

/**
 * CodeMode configuration
 */
export interface CodeModeConfig {
  /** Timeout for code execution in milliseconds */
  executionTimeout?: number;
  /** Enable console log capture */
  captureConsole?: boolean;
  /** Memory limit for VM (in bytes) */
  memoryLimit?: number;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Client interface that CodeMode can install to
 * Compatible with @btcp/client BTCPClient
 */
export interface ToolClient {
  registerTool?(tool: BTCPToolDefinition, handler: (args: Record<string, unknown>) => Promise<BTCPContent[]>): void;
  registerTools?(tools: BTCPToolDefinition[]): void | Promise<void>;
  getExecutor?(): {
    registerHandler(name: string, handler: (args: Record<string, unknown>) => Promise<BTCPContent[]>): void;
  };
}

const DEFAULT_CONFIG: Required<CodeModeConfig> = {
  executionTimeout: 30000,
  captureConsole: true,
  memoryLimit: 128 * 1024 * 1024,
  debug: false,
};

/**
 * CodeMode - Enables agents to execute code that calls registered tools
 *
 * @example
 * ```typescript
 * import { BTCPClient } from '@btcp/client';
 * import { CodeMode } from '@btcp/code-mode';
 *
 * const client = new BTCPClient({ serverUrl: '...' });
 * const codeMode = new CodeMode();
 *
 * // Register tools with code-mode
 * codeMode.registerTools('github', githubTools, callGithubTool);
 * codeMode.registerTools('browser', browserTools, callBrowserTool);
 *
 * // Install code-mode tools to client
 * codeMode.install(client);
 *
 * await client.connect();
 * // Agent sees: callToolChain, getToolInterfaces, searchTools
 * ```
 */
export class CodeMode {
  private config: Required<CodeModeConfig>;
  private sandbox: Sandbox;
  private sources: Map<string, ToolSource> = new Map();
  private toolInterfaces: Map<string, string> = new Map();

  constructor(config: CodeModeConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.sandbox = createSandbox({
      timeout: this.config.executionTimeout,
      captureConsole: this.config.captureConsole,
      memoryLimit: this.config.memoryLimit,
    });
  }

  /**
   * Register tools with a namespace
   *
   * @param namespace - Namespace for the tools (e.g., 'github', 'browser')
   * @param tools - Tool definitions
   * @param callTool - Function to call tools in this namespace
   */
  registerTools(
    namespace: string,
    tools: BTCPToolDefinition[],
    callTool: ToolCaller
  ): void {
    const source: ToolSource = { name: namespace, tools, callTool };
    this.sources.set(namespace, source);

    // Create tool wrappers for sandbox
    const wrappers = this.createToolWrappers(namespace, tools, callTool);

    // Generate interface
    const interfaceDefinition = generateNamespaceInterface(namespace, tools);
    this.toolInterfaces.set(namespace, interfaceDefinition);

    // Register with sandbox
    this.sandbox.registerNamespace(namespace, wrappers, interfaceDefinition);

    this.log(`Registered namespace '${namespace}' with ${tools.length} tools`);
  }

  /**
   * Register a single tool
   */
  registerTool(
    namespace: string,
    tool: BTCPToolDefinition,
    handler: (args: Record<string, unknown>) => Promise<unknown>
  ): void {
    const existing = this.sources.get(namespace);
    if (existing) {
      // Add to existing namespace
      existing.tools.push(tool);
      // Update sandbox
      const wrappers = this.createToolWrappers(namespace, existing.tools, existing.callTool);
      const interfaceDefinition = generateNamespaceInterface(namespace, existing.tools);
      this.toolInterfaces.set(namespace, interfaceDefinition);
      this.sandbox.registerNamespace(namespace, wrappers, interfaceDefinition);
    } else {
      // Create new namespace with single tool
      this.registerTools(namespace, [tool], async (name, args) => {
        if (name === tool.name) {
          return handler(args);
        }
        throw new Error(`Unknown tool: ${name}`);
      });
    }
  }

  /**
   * Install code-mode tools to a client
   * Works with @btcp/client BTCPClient or compatible clients
   */
  install(client: ToolClient): void {
    const tools = this.getCodeModeTools();
    const handlers = this.getCodeModeHandlers();

    // Try different client APIs
    if (client.registerTool) {
      // BTCPClient style
      for (const tool of tools) {
        const handler = handlers.get(tool.name);
        if (handler) {
          client.registerTool(tool, handler);
        }
      }
    } else if (client.registerTools && client.getExecutor) {
      // Alternative style
      client.registerTools(tools);
      const executor = client.getExecutor();
      for (const [name, handler] of handlers) {
        executor.registerHandler(name, handler);
      }
    } else {
      throw new Error(
        'Client must have registerTool() or registerTools()+getExecutor()'
      );
    }

    this.log('Installed code-mode tools to client');
  }

  /**
   * Get tools that code-mode provides to the client
   */
  getCodeModeTools(): BTCPToolDefinition[] {
    return [
      {
        name: 'callToolChain',
        description:
          'Execute TypeScript/JavaScript code that can call multiple tools in sequence or parallel. ' +
          'The code has access to all registered tool namespaces and can use async/await, ' +
          'loops, conditionals, and variables. Use this for complex operations that require ' +
          'multiple tool calls or data transformation between calls.',
        inputSchema: {
          type: 'object',
          properties: {
            code: {
              type: 'string',
              description:
                'TypeScript/JavaScript code to execute. Can use await and access tool namespaces. ' +
                'Must return a value. Example: `const data = await github.getRepo({owner:"foo",repo:"bar"}); return data;`',
            },
            timeout: {
              type: 'number',
              description: 'Optional execution timeout in milliseconds.',
            },
          },
          required: ['code'],
        },
        examples: [
          {
            name: 'Multiple tool calls',
            input: {
              code: `
const repo = await github.getRepo({ owner: 'microsoft', repo: 'vscode' });
const issues = await github.listIssues({ owner: 'microsoft', repo: 'vscode', state: 'open' });
return { name: repo.name, openIssues: issues.length };
`,
            },
          },
        ],
        tags: ['code-mode', 'execution'],
      },
      {
        name: 'getToolInterfaces',
        description:
          'Get TypeScript interface definitions for available tools. ' +
          'Call this before writing code to understand tool schemas.',
        inputSchema: {
          type: 'object',
          properties: {
            namespace: {
              type: 'string',
              description: 'Namespace to get interfaces for. Omit for all namespaces.',
            },
            compact: {
              type: 'boolean',
              description: 'If true, returns a compact one-line-per-tool summary.',
            },
          },
        },
        tags: ['code-mode', 'discovery'],
      },
      {
        name: 'searchTools',
        description: 'Search for tools by name or description.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query.',
            },
            limit: {
              type: 'number',
              description: 'Max results (default: 10).',
            },
          },
          required: ['query'],
        },
        tags: ['code-mode', 'discovery'],
      },
    ];
  }

  /**
   * Get handlers for code-mode tools
   */
  getCodeModeHandlers(): Map<string, (args: Record<string, unknown>) => Promise<BTCPContent[]>> {
    const handlers = new Map<string, (args: Record<string, unknown>) => Promise<BTCPContent[]>>();

    handlers.set('callToolChain', async (args) => {
      const code = args.code as string;
      const timeout = args.timeout as number | undefined;
      const result = await this.callToolChain(code, timeout);
      return [createTextContent(JSON.stringify(result, null, 2))];
    });

    handlers.set('getToolInterfaces', async (args) => {
      const namespace = args.namespace as string | undefined;
      const compact = args.compact as boolean | undefined;
      const result = this.getToolInterfaces(namespace, compact);
      return [createTextContent(result)];
    });

    handlers.set('searchTools', async (args) => {
      const query = args.query as string;
      const limit = args.limit as number | undefined;
      const results = this.searchTools(query, limit);
      return [createTextContent(JSON.stringify(results, null, 2))];
    });

    return handlers;
  }

  /**
   * Execute a tool chain as code
   */
  async callToolChain(code: string, timeout?: number): Promise<ToolChainResult> {
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
      const source = this.sources.get(namespace);
      if (!source) {
        return `Namespace '${namespace}' not found. Available: ${this.getNamespaces().join(', ')}`;
      }
      if (compact) {
        return generateCompactInterface(namespace, source.tools);
      }
      return this.toolInterfaces.get(namespace) || '';
    }

    // Return all
    if (compact) {
      const summaries: string[] = [];
      for (const [ns, source] of this.sources) {
        summaries.push(generateCompactInterface(ns, source.tools));
      }
      return summaries.join('\n\n');
    }

    return Array.from(this.toolInterfaces.values()).join('\n\n');
  }

  /**
   * Search for tools
   */
  searchTools(query: string, limit: number = 10): ToolSearchResult[] {
    const results: ToolSearchResult[] = [];
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/);

    for (const [namespace, source] of this.sources) {
      for (const tool of source.tools) {
        const nameLower = tool.name.toLowerCase();
        const descLower = tool.description.toLowerCase();

        let score = 0;

        if (nameLower === queryLower) score += 100;
        if (nameLower.includes(queryLower)) score += 50;
        if (descLower.includes(queryLower)) score += 25;

        for (const word of queryWords) {
          if (nameLower.includes(word)) score += 10;
          if (descLower.includes(word)) score += 5;
        }

        if (tool.tags) {
          for (const tag of tool.tags) {
            if (tag.toLowerCase().includes(queryLower)) score += 15;
          }
        }

        if (score > 0) {
          results.push({ namespace, tool, score });
        }
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  /**
   * Get all namespaces
   */
  getNamespaces(): string[] {
    return Array.from(this.sources.keys());
  }

  /**
   * Get all tools in a namespace
   */
  getTools(namespace: string): BTCPToolDefinition[] | undefined {
    return this.sources.get(namespace)?.tools;
  }

  /**
   * Get all registered tools
   */
  getAllTools(): Map<string, BTCPToolDefinition[]> {
    const result = new Map<string, BTCPToolDefinition[]>();
    for (const [ns, source] of this.sources) {
      result.set(ns, source.tools);
    }
    return result;
  }

  /**
   * Create tool wrappers for sandbox
   */
  private createToolWrappers(
    namespace: string,
    tools: BTCPToolDefinition[],
    callTool: ToolCaller
  ): Map<string, (args: Record<string, unknown>) => Promise<unknown>> {
    const wrappers = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();

    for (const tool of tools) {
      wrappers.set(tool.name, async (args: Record<string, unknown>) => {
        return callTool(tool.name, args);
      });
    }

    return wrappers;
  }

  /**
   * Log if debug enabled
   */
  private log(...args: unknown[]): void {
    if (this.config.debug) {
      console.log('[CodeMode]', ...args);
    }
  }
}

/**
 * Create a CodeMode instance
 */
export function createCodeMode(config?: CodeModeConfig): CodeMode {
  return new CodeMode(config);
}
