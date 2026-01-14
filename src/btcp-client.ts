/**
 * BTCP Client
 * Base client for Browser Tool Calling Protocol
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
  ToolHandler,
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
  normalizeContent,
} from './protocol.js';

const DEFAULT_CONFIG: Required<BTCPClientConfig> = {
  serverUrl: 'http://localhost:8765',
  sessionId: '',
  version: '1.0.0',
  autoReconnect: true,
  reconnectDelay: 1000,
  maxReconnectAttempts: 5,
  connectionTimeout: 10000,
  debug: false,
};

// EventSource polyfill for Node.js
let EventSourceImpl: typeof EventSource;

/**
 * Extension interface for adding functionality to BTCPClient
 */
export interface BTCPClientExtension {
  /** Name of the extension */
  name: string;
  /** Called when extension is registered */
  onRegister?(client: BTCPClient): void | Promise<void>;
  /** Called when client connects */
  onConnect?(client: BTCPClient): void | Promise<void>;
  /** Called when client disconnects */
  onDisconnect?(client: BTCPClient): void | Promise<void>;
  /** Get tools provided by this extension */
  getTools?(): BTCPToolDefinition[];
  /** Get tool handlers provided by this extension */
  getHandlers?(): Map<string, ToolHandler>;
}

/**
 * BTCPClient - Base client for Browser Tool Calling Protocol
 */
export class BTCPClient {
  private config: Required<BTCPClientConfig>;
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
  private abortController: AbortController | null = null;

  // Tool management
  private registeredTools: Map<string, BTCPToolDefinition> = new Map();
  private toolHandlers: Map<string, ToolHandler> = new Map();
  private disabledTools: Set<string> = new Set();
  private extensions: Map<string, BTCPClientExtension> = new Map();

  constructor(config: BTCPClientConfig = {}) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      sessionId: config.sessionId || generateMessageId(),
    };

    // Register default handlers
    this.registerDefaultHandlers();
  }

  /**
   * Create a new BTCPClient instance
   */
  static create(config: BTCPClientConfig = {}): BTCPClient {
    return new BTCPClient(config);
  }

  /**
   * Get session ID
   */
  getSessionId(): string {
    return this.config.sessionId;
  }

  /**
   * Get server URL
   */
  getServerUrl(): string {
    return this.config.serverUrl;
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
   * Check if debug mode is enabled
   */
  isDebugEnabled(): boolean {
    return this.config.debug;
  }

  // ===========================================================================
  // Extension Management
  // ===========================================================================

  /**
   * Register an extension
   */
  async use(extension: BTCPClientExtension): Promise<this> {
    if (this.extensions.has(extension.name)) {
      throw new Error(`Extension '${extension.name}' is already registered`);
    }

    this.extensions.set(extension.name, extension);

    // Register extension's tools
    const tools = extension.getTools?.() || [];
    for (const tool of tools) {
      this.registeredTools.set(tool.name, tool);
    }

    // Register extension's handlers
    const handlers = extension.getHandlers?.() || new Map();
    for (const [name, handler] of handlers) {
      this.toolHandlers.set(name, handler);
    }

    // Call onRegister hook
    await extension.onRegister?.(this);

    this.log(`Extension '${extension.name}' registered`);
    return this;
  }

  /**
   * Get an extension by name
   */
  getExtension<T extends BTCPClientExtension>(name: string): T | undefined {
    return this.extensions.get(name) as T | undefined;
  }

  // ===========================================================================
  // Tool Management
  // ===========================================================================

  /**
   * Register a tool
   */
  registerTool(tool: BTCPToolDefinition, handler?: ToolHandler): void {
    this.registeredTools.set(tool.name, tool);
    if (handler) {
      this.toolHandlers.set(tool.name, handler);
    }
    this.log(`Tool '${tool.name}' registered`);
  }

  /**
   * Register a tool handler
   */
  registerHandler(name: string, handler: ToolHandler): void {
    this.toolHandlers.set(name, handler);
  }

  /**
   * Check if a handler exists
   */
  hasHandler(name: string): boolean {
    return this.toolHandlers.has(name);
  }

  /**
   * Get all registered tools (respecting disabled state)
   */
  getTools(includeDisabled: boolean = false): BTCPToolDefinition[] {
    const tools: BTCPToolDefinition[] = [];
    for (const [name, tool] of this.registeredTools) {
      if (includeDisabled || !this.disabledTools.has(name)) {
        tools.push(tool);
      }
    }
    return tools;
  }

  /**
   * Get all registered tools as a map
   */
  getToolsMap(): Map<string, BTCPToolDefinition> {
    return new Map(this.registeredTools);
  }

  /**
   * Disable a tool (hide from external clients)
   */
  disableTool(name: string): void {
    this.disabledTools.add(name);
    this.log(`Tool '${name}' disabled`);
  }

  /**
   * Enable a previously disabled tool
   */
  enableTool(name: string): void {
    this.disabledTools.delete(name);
    this.log(`Tool '${name}' enabled`);
  }

  /**
   * Disable all tools except the specified ones
   */
  disableAllToolsExcept(...names: string[]): void {
    const keepEnabled = new Set(names);
    for (const name of this.registeredTools.keys()) {
      if (!keepEnabled.has(name)) {
        this.disabledTools.add(name);
      }
    }
    this.log(`Disabled all tools except: ${names.join(', ')}`);
  }

  /**
   * Enable all tools
   */
  enableAllTools(): void {
    this.disabledTools.clear();
    this.log('All tools enabled');
  }

  /**
   * Check if a tool is disabled
   */
  isToolDisabled(name: string): boolean {
    return this.disabledTools.has(name);
  }

  /**
   * Execute a tool by name (internal use)
   */
  async executeTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<BTCPContent[]> {
    const handler = this.toolHandlers.get(name);

    if (!handler) {
      throw new Error(`No handler registered for tool: ${name}`);
    }

    this.log(`Executing tool: ${name}`, args);

    try {
      const result = await handler(args);
      return normalizeContent(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Tool '${name}' execution failed: ${message}`);
    }
  }

  /**
   * Call a tool on the remote BTCP server
   */
  async callRemoteTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    if (!this.isConnected()) {
      throw new BTCPConnectionError('Not connected to server');
    }

    const response = await this.sendRequest('tools/call', {
      name,
      arguments: args,
    });

    if (response.error) {
      throw new BTCPConnectionError(
        `Tool call failed: ${response.error.message}`
      );
    }

    const result = response.result as {
      content: BTCPContent[];
      isError?: boolean;
    };

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
   * Fetch tools from the remote BTCP server
   */
  async fetchRemoteTools(): Promise<BTCPToolDefinition[]> {
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

  // ===========================================================================
  // Connection Management
  // ===========================================================================

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

        this.eventSource.onopen = async () => {
          clearTimeout(timeout);
          this.isConnecting = false;
          this.reconnectAttempts = 0;
          this.log('Connected to BTCP server via SSE');

          // Notify extensions
          for (const extension of this.extensions.values()) {
            await extension.onConnect?.(this);
          }

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
  async disconnect(): Promise<void> {
    this.config.autoReconnect = false;

    // Notify extensions
    for (const extension of this.extensions.values()) {
      await extension.onDisconnect?.(this);
    }

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

  // ===========================================================================
  // Message Handling
  // ===========================================================================

  /**
   * Send a JSON-RPC request via HTTP POST and wait for response
   */
  async sendRequest(
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

  // ===========================================================================
  // Event Handling
  // ===========================================================================

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

    // Return only enabled tools
    const tools = this.getTools(false);
    await this.send(createResponse(request.id, { tools }));
  }

  /**
   * Handle tools/call request
   */
  private async handleToolCall(request: BTCPToolCallRequest): Promise<void> {
    this.emit('toolCall', request);

    const { name, arguments: args } = request.params;

    // Check if tool is disabled
    if (this.disabledTools.has(name)) {
      await this.send(
        createToolCallErrorResponse(request.id, `Tool '${name}' is disabled`)
      );
      return;
    }

    try {
      const result = await this.executeTool(name, args);
      await this.send(createToolCallResponse(request.id, result));
    } catch (err) {
      this.log(`Tool execution error for ${name}:`, err);
      await this.send(createToolCallErrorResponse(request.id, err as Error));
    }
  }

  /**
   * Handle disconnect and auto-reconnect
   */
  private async handleDisconnect(): Promise<void> {
    this.eventSource = null;

    // Notify extensions
    for (const extension of this.extensions.values()) {
      await extension.onDisconnect?.(this);
    }

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
   * Register default utility handlers
   */
  private registerDefaultHandlers(): void {
    // Echo handler for testing
    this.toolHandlers.set('echo', async (args) => {
      return JSON.stringify(args);
    });

    // Ping handler
    this.toolHandlers.set('ping', async () => {
      return 'pong';
    });
  }

  /**
   * Log message if debug is enabled
   */
  log(...args: unknown[]): void {
    if (this.config.debug) {
      console.log('[BTCPClient]', ...args);
    }
  }
}
