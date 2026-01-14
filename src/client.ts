/**
 * BTCP Code-Mode Client
 * Convenience wrapper combining BTCPClient with CodeModeExtension
 *
 * @deprecated Use BTCPClient with CodeModeExtension instead for more flexibility
 */

import { BTCPClient } from './btcp-client.js';
import {
  CodeModeExtension,
  CodeModeExtensionConfig,
  createCodeModeExtension,
} from './code-mode-extension.js';
import {
  CodeModeConfig,
  BTCPToolDefinition,
  ToolChainResult,
  ToolSearchResult,
  BTCPClientEvents,
  BTCPClientEventHandler,
} from './types.js';

/**
 * CodeModeBtcpClient - Convenience class combining BTCPClient with CodeModeExtension
 *
 * For new implementations, prefer using BTCPClient with CodeModeExtension directly:
 *
 * ```typescript
 * const client = BTCPClient.create({ serverUrl: '...' });
 * const codeMode = createCodeModeExtension({ exclusiveMode: true });
 * await client.use(codeMode);
 * await client.connect();
 * ```
 */
export class CodeModeBtcpClient {
  private client: BTCPClient;
  private codeMode: CodeModeExtension;

  private constructor(
    client: BTCPClient,
    codeMode: CodeModeExtension
  ) {
    this.client = client;
    this.codeMode = codeMode;
  }

  /**
   * Create a new CodeModeBtcpClient instance
   */
  static async create(config: CodeModeConfig = {}): Promise<CodeModeBtcpClient> {
    const client = BTCPClient.create({
      serverUrl: config.serverUrl,
      sessionId: config.sessionId,
      version: config.version,
      autoReconnect: config.autoReconnect,
      reconnectDelay: config.reconnectDelay,
      maxReconnectAttempts: config.maxReconnectAttempts,
      connectionTimeout: config.connectionTimeout,
      debug: config.debug,
    });

    const codeMode = createCodeModeExtension({
      executionTimeout: config.executionTimeout,
      captureConsole: config.captureConsole,
      memoryLimit: config.memoryLimit,
    });

    await client.use(codeMode);

    return new CodeModeBtcpClient(client, codeMode);
  }

  /**
   * Get the underlying BTCPClient
   */
  getClient(): BTCPClient {
    return this.client;
  }

  /**
   * Get the CodeModeExtension
   */
  getCodeMode(): CodeModeExtension {
    return this.codeMode;
  }

  /**
   * Get session ID
   */
  getSessionId(): string {
    return this.client.getSessionId();
  }

  /**
   * Check if client is connected
   */
  isConnected(): boolean {
    return this.client.isConnected();
  }

  /**
   * Connect to the BTCP server
   */
  async connect(): Promise<void> {
    await this.client.connect();
  }

  /**
   * Disconnect from the server
   */
  async disconnect(): Promise<void> {
    await this.client.disconnect();
  }

  /**
   * Register a BTCP tool source
   */
  async registerBtcp(config: {
    name: string;
    serverUrl?: string;
    sessionId?: string;
  }): Promise<void> {
    // Connect if not already connected
    if (!this.isConnected()) {
      await this.connect();
    }

    // Fetch and register tools
    await this.codeMode.registerRemoteTools(config.name);
  }

  /**
   * Register tools manually
   */
  registerManual(config: {
    name: string;
    tools: BTCPToolDefinition[];
    callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  }): void {
    // Register each tool with the client
    for (const tool of config.tools) {
      this.client.registerTool(tool, async (args) => {
        return config.callTool(tool.name, args);
      });
    }

    // Register namespace with code-mode
    this.codeMode.registerToolsNamespace(config.name, config.tools);
  }

  /**
   * Execute a tool chain as code
   */
  async callToolChain(code: string, timeout?: number): Promise<ToolChainResult> {
    return this.codeMode.callToolChain(code, timeout);
  }

  /**
   * Search for tools
   */
  searchTools(query: string, limit?: number): ToolSearchResult[] {
    return this.codeMode.searchTools(query, limit);
  }

  /**
   * Get all registered tools
   */
  getAllTools(): Map<string, BTCPToolDefinition[]> {
    return this.codeMode.getAllTools();
  }

  /**
   * Get tool interface for a namespace
   */
  getToolInterface(namespace: string): string | undefined {
    return this.codeMode.getToolInterfaces(namespace);
  }

  /**
   * Get compact tool summary
   */
  getCompactToolSummary(): string {
    return this.codeMode.getToolInterfaces(undefined, true);
  }

  /**
   * Enable exclusive mode (only code-mode tools exposed)
   */
  enableExclusiveMode(): void {
    this.codeMode.enableExclusiveMode();
  }

  /**
   * Disable exclusive mode (all tools exposed)
   */
  disableExclusiveMode(): void {
    this.codeMode.disableExclusiveMode();
  }

  /**
   * Add event listener
   */
  on<K extends keyof BTCPClientEvents>(
    event: K,
    handler: BTCPClientEventHandler<K>
  ): void {
    this.client.on(event, handler);
  }

  /**
   * Remove event listener
   */
  off<K extends keyof BTCPClientEvents>(
    event: K,
    handler: BTCPClientEventHandler<K>
  ): void {
    this.client.off(event, handler);
  }
}
