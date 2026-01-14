/**
 * Tool Executor
 * Handles tool execution and result normalization for BTCP tools
 */

import {
  BTCPContent,
  BTCPToolDefinition,
  BTCPExecutionError,
  BTCPToolNotFoundError,
  ToolHandler,
  ToolExecutorConfig,
} from './types.js';
import { normalizeContent, createTextContent } from './protocol.js';

/**
 * ToolExecutor manages tool handlers and executes tools
 */
export class ToolExecutor {
  private handlers: Map<string, ToolHandler>;
  private debug: boolean;

  constructor(config: ToolExecutorConfig = {}) {
    this.handlers = config.handlers ?? new Map();
    this.debug = config.debug ?? false;

    // Register default handlers
    this.registerDefaultHandlers();
  }

  /**
   * Register a tool handler
   */
  registerHandler(name: string, handler: ToolHandler): void {
    this.handlers.set(name, handler);
    this.log(`Registered handler: ${name}`);
  }

  /**
   * Check if a handler exists
   */
  hasHandler(name: string): boolean {
    return this.handlers.has(name);
  }

  /**
   * Remove a handler
   */
  removeHandler(name: string): boolean {
    return this.handlers.delete(name);
  }

  /**
   * Get all registered handler names
   */
  getHandlerNames(): string[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * Execute a tool by name
   */
  async execute(
    name: string,
    args: Record<string, unknown>
  ): Promise<BTCPContent[]> {
    const handler = this.handlers.get(name);

    if (!handler) {
      throw new BTCPToolNotFoundError(name);
    }

    this.log(`Executing tool: ${name}`, args);

    try {
      const result = await handler(args);
      return normalizeContent(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new BTCPExecutionError(`Tool '${name}' execution failed: ${message}`);
    }
  }

  /**
   * Execute multiple tools in sequence
   */
  async executeSequence(
    calls: Array<{ name: string; args: Record<string, unknown> }>
  ): Promise<BTCPContent[][]> {
    const results: BTCPContent[][] = [];

    for (const call of calls) {
      const result = await this.execute(call.name, call.args);
      results.push(result);
    }

    return results;
  }

  /**
   * Execute multiple tools in parallel
   */
  async executeParallel(
    calls: Array<{ name: string; args: Record<string, unknown> }>
  ): Promise<BTCPContent[][]> {
    const promises = calls.map((call) => this.execute(call.name, call.args));
    return Promise.all(promises);
  }

  /**
   * Register default utility handlers
   */
  private registerDefaultHandlers(): void {
    // Echo handler for testing
    this.handlers.set('echo', async (args) => {
      return [createTextContent(JSON.stringify(args))];
    });

    // Sleep/delay handler
    this.handlers.set('sleep', async (args) => {
      const ms = typeof args.ms === 'number' ? args.ms : 1000;
      await new Promise((resolve) => setTimeout(resolve, ms));
      return [createTextContent(`Slept for ${ms}ms`)];
    });
  }

  /**
   * Log message if debug is enabled
   */
  private log(...args: unknown[]): void {
    if (this.debug) {
      console.log('[ToolExecutor]', ...args);
    }
  }
}

/**
 * Create tool function wrappers for sandbox execution
 */
export function createToolWrappers(
  tools: BTCPToolDefinition[],
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>
): Map<string, (args: Record<string, unknown>) => Promise<unknown>> {
  const wrappers = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();

  for (const tool of tools) {
    wrappers.set(tool.name, async (args: Record<string, unknown>) => {
      return callTool(tool.name, args);
    });
  }

  return wrappers;
}
