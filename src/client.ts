/**
 * BTCP Code-Mode Client
 * Main client class that combines BTCP connection with code execution capabilities
 */

import {
  BTCPClientConfig,
  BTCPClientEvents,
  BTCPClientEventHandler,
  BTCPToolDefinition,
  BTCPToolCallRequest,
  BTCPToolsListRequest,
  BTCPToolsListResponse,
  BTCPContent,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcNotification,
  BTCPConnectionError,
  CodeModeConfig,
  ToolChainResult,
  RegisteredToolSource,
  ToolSearchResult,
} from './types.js';

import {
  createRequest,
  createResponse,
  createToolCallResponse,
  createToolCallErrorResponse,
  parseMessage,
  serializeMessage,
  isRequest,
  isResponse,
  generateMessageId,
} from './protocol.js';

import { ToolExecutor, createToolWrappers } from './executor.js';
import { Sandbox, createSandbox } from './sandbox.js';
import {
  generateNamespaceInterface,
  generateCompactInterface,
} from './interface-generator.js';

const DEFAULT_CONFIG: Required<CodeModeConfig> = {
  serverUrl: 'http://localhost:8765',
  sessionId: '',
  version: '1.0.0',
  autoReconnect: true,
  reconnectDelay: 1000,
  maxReconnectAttempts: 5,
  connectionTimeout: 10000,
  debug: false,
  executionTimeout: 30000,
  captureConsole: true,
  memoryLimit: 128 * 1024 * 1024,
};

// EventSource polyfill for Node.js
let EventSourceImpl: typeof EventSource;

/**
 * CodeModeBtcpClient - Main client for BTCP code-mode execution
 *
 * Enables AI agents to execute TypeScript code that calls BTCP tools,
 * instead of using traditional function-calling approaches.
 */
export class CodeModeBtcpClient {
  private config: Required<CodeModeConfig>;
  private eventSource: EventSource | null = null;
  private eventHandlers: Map<keyof BTCPClientEvents, Set<Function>> = new Map();
  private pendingRequests: Map<
    string | number,
    {
      resolve: (value: JsonRpcResponse) => void;
      reject: (error: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  > = new Map();
  private reconnectAttempts = 0;
  private isConnecting = false;
  private executor: ToolExecutor;
  private sandbox: Sandbox;
  private registeredSources: Map<string, RegisteredToolSource> = new Map();
  private abortController: AbortController | null = null;

  private constructor(config: CodeModeConfig = {}) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      sessionId: config.sessionId || generateMessageId(),
    };
    this.executor = new ToolExecutor({ debug: this.config.debug });
    this.sandbox = createSandbox({
      timeout: this.config.executionTimeout,
      captureConsole: this.config.captureConsole,
      memoryLimit: this.config.memoryLimit,
    });
  }

  /**
   * Create a new CodeModeBtcpClient instance
   */
  static async create(config: CodeModeConfig = {}): Promise<CodeModeBtcpClient> {
    const client = new CodeModeBtcpClient(config);
    return client;
  }

  /**
   * Get the tool executor
   */
  getExecutor(): ToolExecutor {
    return this.executor;
  }

  /**
   * Get the sandbox instance
   */
  getSandbox(): Sandbox {
    return this.sandbox;
  }

  /**
   * Get session ID
   */
  getSessionId(): string {
    return this.config.sessionId;
  }

  /**
   * Check if client is connected
   */
  isConnected(): boolean {
    return (
      this.eventSource !== null &&
      this.eventSource.readyState === EventSource.OPEN
    );
  }

  /**
   * Connect to the BTCP server using SSE
   */
  async connect(): Promise<void> {
    if (this.isConnected()) {
      return;
    }

    if (this.isConnecting) {
      throw new BTCPConnectionError('Connection already in progress');
    }

    this.isConnecting = true;
    this.abortController = new AbortController();

    // Ensure EventSource is available
    await this.ensureEventSource();

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.isConnecting = false;
        reject(new BTCPConnectionError('Connection timeout'));
      }, this.config.connectionTimeout);

      try {
        const sseUrl = `${this.config.serverUrl}/events?sessionId=${encodeURIComponent(this.config.sessionId)}&clientType=agent&version=${this.config.version}`;

        this.eventSource = new EventSourceImpl(sseUrl);

        this.eventSource.onopen = () => {
          clearTimeout(timeout);
          this.isConnecting = false;
          this.reconnectAttempts = 0;
          this.log('Connected to BTCP server via SSE');
          this.emit('connect');
          resolve();
        };

        this.eventSource.onerror = () => {
          clearTimeout(timeout);
          if (this.isConnecting) {
            this.isConnecting = false;
            const error = new BTCPConnectionError('SSE connection error');
            this.emit('error', error);
            reject(error);
          } else {
            this.handleDisconnect();
          }
        };

        this.eventSource.onmessage = (event) => {
          this.handleMessage(event.data);
        };

        // Listen for specific event types
        this.eventSource.addEventListener('request', (event) => {
          this.handleMessage((event as MessageEvent).data);
        });

        this.eventSource.addEventListener('response', (event) => {
          this.handleMessage((event as MessageEvent).data);
        });
      } catch (err) {
        clearTimeout(timeout);
        this.isConnecting = false;
        reject(
          new BTCPConnectionError(
            `Failed to connect: ${(err as Error).message}`
          )
        );
      }
    });
  }

  /**
   * Ensure EventSource is available (polyfill for Node.js)
   */
  private async ensureEventSource(): Promise<void> {
    if (typeof globalThis.EventSource !== 'undefined') {
      EventSourceImpl = globalThis.EventSource;
      return;
    }

    // Node.js environment - use eventsource package
    try {
      const { default: EventSource } = await import('eventsource');
      EventSourceImpl = EventSource as unknown as typeof globalThis.EventSource;
    } catch {
      throw new BTCPConnectionError(
        'EventSource not available. Install eventsource package: npm install eventsource'
      );
    }
  }

  /**
   * Disconnect from the server
   */
  disconnect(): void {
    this.config.autoReconnect = false;

    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    // Clear pending requests
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new BTCPConnectionError('Client disconnected'));
    }
    this.pendingRequests.clear();

    this.emit('disconnect', 1000, 'Client disconnected');
  }

  /**
   * Register a BTCP tool source
   */
  async registerBtcp(config: {
    name: string;
    serverUrl?: string;
    sessionId?: string;
  }): Promise<void> {
    const serverUrl = config.serverUrl || this.config.serverUrl;

    // Connect if not already connected
    if (!this.isConnected() && serverUrl === this.config.serverUrl) {
      await this.connect();
    }

    // Fetch tools from the BTCP server
    const tools = await this.fetchTools();

    // Register the source
    const source: RegisteredToolSource = {
      name: config.name,
      type: 'btcp',
      tools,
      config: { serverUrl, sessionId: config.sessionId },
    };

    this.registeredSources.set(config.name, source);

    // Create tool wrappers for the sandbox
    const toolWrappers = createToolWrappers(tools, (name, args) =>
      this.callTool(name, args)
    );

    // Generate interface for the namespace
    const interfaceDefinition = generateNamespaceInterface(config.name, tools);

    // Register with sandbox
    this.sandbox.registerNamespace(config.name, toolWrappers, interfaceDefinition);

    this.log(`Registered BTCP source: ${config.name} with ${tools.length} tools`);
  }

  /**
   * Register tools manually (without connecting to a server)
   */
  registerManual(config: {
    name: string;
    tools: BTCPToolDefinition[];
    callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  }): void {
    const source: RegisteredToolSource = {
      name: config.name,
      type: 'btcp',
      tools: config.tools,
    };

    this.registeredSources.set(config.name, source);

    // Create tool wrappers
    const toolWrappers = createToolWrappers(config.tools, config.callTool);

    // Generate interface
    const interfaceDefinition = generateNamespaceInterface(config.name, config.tools);

    // Register with sandbox
    this.sandbox.registerNamespace(config.name, toolWrappers, interfaceDefinition);

    this.log(`Registered manual source: ${config.name} with ${config.tools.length} tools`);
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
   * Search for tools across all registered sources
   */
  searchTools(query: string, limit: number = 10): ToolSearchResult[] {
    const results: ToolSearchResult[] = [];
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/);

    for (const [namespace, source] of this.registeredSources) {
      for (const tool of source.tools) {
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
   * Get all registered tools
   */
  getAllTools(): Map<string, BTCPToolDefinition[]> {
    const toolMap = new Map<string, BTCPToolDefinition[]>();

    for (const [namespace, source] of this.registeredSources) {
      toolMap.set(namespace, source.tools);
    }

    return toolMap;
  }

  /**
   * Get tool interfaces for a namespace
   */
  getToolInterface(namespace: string): string | undefined {
    return this.sandbox.getInterface(namespace);
  }

  /**
   * Get compact tool summary for prompts
   */
  getCompactToolSummary(): string {
    const summaries: string[] = [];

    for (const [namespace, source] of this.registeredSources) {
      summaries.push(generateCompactInterface(namespace, source.tools));
    }

    return summaries.join('\n\n');
  }

  /**
   * Fetch tools from the BTCP server
   */
  private async fetchTools(): Promise<BTCPToolDefinition[]> {
    if (!this.isConnected()) {
      throw new BTCPConnectionError('Not connected to server');
    }

    const response = await this.sendRequest('tools/list');

    if (response.error) {
      throw new BTCPConnectionError(
        `Failed to fetch tools: ${response.error.message}`
      );
    }

    const result = response.result as BTCPToolsListResponse['result'];
    return result.tools;
  }

  /**
   * Call a tool on the BTCP server
   */
  private async callTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    if (!this.isConnected()) {
      throw new BTCPConnectionError('Not connected to server');
    }

    const response = await this.sendRequest('tools/call', { name, arguments: args });

    if (response.error) {
      throw new BTCPConnectionError(
        `Tool call failed: ${response.error.message}`
      );
    }

    const result = response.result as { content: BTCPContent[]; isError?: boolean };

    if (result.isError) {
      const errorText = result.content
        .filter((c) => c.type === 'text')
        .map((c) => c.text)
        .join('\n');
      throw new Error(errorText || 'Tool execution failed');
    }

    // Return parsed result
    if (result.content.length === 1 && result.content[0].type === 'text') {
      const text = result.content[0].text || '';
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }

    return result.content;
  }

  /**
   * Send a JSON-RPC request via HTTP POST and wait for response
   */
  private async sendRequest(
    method: string,
    params?: Record<string, unknown>,
    timeout = 30000
  ): Promise<JsonRpcResponse> {
    if (!this.isConnected()) {
      throw new BTCPConnectionError('Not connected to server');
    }

    const request = createRequest(method, params);

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(request.id);
        reject(new BTCPConnectionError(`Request timeout: ${method}`));
      }, timeout);

      this.pendingRequests.set(request.id, {
        resolve,
        reject,
        timeout: timeoutId,
      });

      this.postMessage(request).catch((err) => {
        this.pendingRequests.delete(request.id);
        clearTimeout(timeoutId);
        reject(err);
      });
    });
  }

  /**
   * Send a message via HTTP POST (no response expected)
   */
  async send(
    message: JsonRpcRequest | JsonRpcResponse | JsonRpcNotification
  ): Promise<void> {
    await this.postMessage(message);
  }

  /**
   * Post a message to the server via HTTP
   */
  private async postMessage(
    message: JsonRpcRequest | JsonRpcResponse | JsonRpcNotification
  ): Promise<void> {
    const url = `${this.config.serverUrl}/message`;
    const body = serializeMessage(message);

    this.log('Sending:', body);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-ID': this.config.sessionId,
      },
      body,
      signal: this.abortController?.signal,
    });

    if (!response.ok) {
      throw new BTCPConnectionError(`HTTP error: ${response.status}`);
    }

    // Check if there's a response body
    const text = await response.text();
    if (text) {
      const parsed = parseMessage(text);
      if (parsed && isResponse(parsed)) {
        this.handleResponseMessage(parsed);
      }
    }
  }

  /**
   * Add event listener
   */
  on<K extends keyof BTCPClientEvents>(
    event: K,
    handler: BTCPClientEventHandler<K>
  ): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);
  }

  /**
   * Remove event listener
   */
  off<K extends keyof BTCPClientEvents>(
    event: K,
    handler: BTCPClientEventHandler<K>
  ): void {
    this.eventHandlers.get(event)?.delete(handler);
  }

  /**
   * Emit an event
   */
  private emit<K extends keyof BTCPClientEvents>(
    event: K,
    ...args: Parameters<BTCPClientEvents[K]>
  ): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          (handler as Function)(...args);
        } catch (err) {
          this.log(`Error in event handler for ${event}:`, err);
        }
      }
    }
  }

  /**
   * Handle incoming SSE message
   */
  private handleMessage(data: string): void {
    this.log('Received:', data);

    const message = parseMessage(data);
    if (!message) {
      this.log('Invalid message received');
      return;
    }

    // Handle response to pending request
    if (isResponse(message)) {
      this.handleResponseMessage(message);
      return;
    }

    // Handle incoming request
    if (isRequest(message)) {
      this.handleRequest(message);
      return;
    }

    // Emit generic message event for notifications
    this.emit('message', message);
  }

  /**
   * Handle response message
   */
  private handleResponseMessage(response: JsonRpcResponse): void {
    const pending = this.pendingRequests.get(response.id);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(response.id);
      pending.resolve(response);
    }
  }

  /**
   * Handle incoming request from server
   */
  private async handleRequest(request: JsonRpcRequest): Promise<void> {
    this.log(`Handling request: ${request.method}`);

    switch (request.method) {
      case 'tools/list':
        await this.handleToolsList(request as BTCPToolsListRequest);
        break;

      case 'tools/call':
        await this.handleToolCall(request as BTCPToolCallRequest);
        break;

      case 'ping':
        await this.send(createResponse(request.id, { pong: true }));
        break;

      default:
        this.log(`Unknown method: ${request.method}`);
        await this.send(
          createResponse(request.id, undefined, {
            code: -32601,
            message: `Method not found: ${request.method}`,
          })
        );
    }
  }

  /**
   * Handle tools/list request
   */
  private async handleToolsList(request: BTCPToolsListRequest): Promise<void> {
    this.emit('toolsList', request);

    const allTools: BTCPToolDefinition[] = [];
    for (const source of this.registeredSources.values()) {
      allTools.push(...source.tools);
    }

    await this.send(createResponse(request.id, { tools: allTools }));
  }

  /**
   * Handle tools/call request
   */
  private async handleToolCall(request: BTCPToolCallRequest): Promise<void> {
    this.emit('toolCall', request);

    const { name, arguments: args } = request.params;

    try {
      const result = await this.executor.execute(name, args);
      await this.send(createToolCallResponse(request.id, result));
    } catch (err) {
      this.log(`Tool execution error for ${name}:`, err);
      await this.send(createToolCallErrorResponse(request.id, err as Error));
    }
  }

  /**
   * Handle disconnect and auto-reconnect
   */
  private handleDisconnect(): void {
    this.eventSource = null;
    this.emit('disconnect', 0, 'Connection lost');

    if (!this.config.autoReconnect) {
      return;
    }

    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      this.log('Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay =
      this.config.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    this.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    setTimeout(() => {
      this.connect().catch((err) => {
        this.log('Reconnection failed:', err);
      });
    }, delay);
  }

  /**
   * Log message if debug is enabled
   */
  private log(...args: unknown[]): void {
    if (this.config.debug) {
      console.log('[BTCP-CodeMode]', ...args);
    }
  }
}
