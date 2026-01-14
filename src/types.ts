/**
 * BTCP Code-Mode Types
 * Type definitions for the Browser Tool Calling Protocol code execution mode
 */

// ============================================================================
// JSON-RPC Types
// ============================================================================

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

// ============================================================================
// JSON Schema Types
// ============================================================================

export interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema | JsonSchema[];
  enum?: unknown[];
  default?: unknown;
  description?: string;
  format?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  allOf?: JsonSchema[];
  $ref?: string;
  [key: string]: unknown;
}

// ============================================================================
// BTCP Tool Types
// ============================================================================

export interface BTCPToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema?: JsonSchema;
  capabilities?: string[];
  timeout?: number;
  examples?: BTCPToolExample[];
  deprecated?: boolean;
  tags?: string[];
}

export interface BTCPToolExample {
  name?: string;
  description?: string;
  input: Record<string, unknown>;
  output?: unknown;
}

export interface BTCPContent {
  type: 'text' | 'image' | 'resource';
  text?: string;
  data?: string;
  mimeType?: string;
  uri?: string;
}

// ============================================================================
// BTCP Message Types
// ============================================================================

export type BTCPMessageType =
  | 'hello'
  | 'tools/list'
  | 'tools/call'
  | 'tools/register'
  | 'session/join'
  | 'session/leave'
  | 'capabilities/request'
  | 'capabilities/grant'
  | 'ping'
  | 'pong';

export interface BTCPToolsListRequest extends JsonRpcRequest {
  method: 'tools/list';
}

export interface BTCPToolsListResponse extends JsonRpcResponse {
  result: {
    tools: BTCPToolDefinition[];
  };
}

export interface BTCPToolCallRequest extends JsonRpcRequest {
  method: 'tools/call';
  params: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

export interface BTCPToolCallResponse extends JsonRpcResponse {
  result: {
    content: BTCPContent[];
    isError?: boolean;
  };
}

export interface BTCPToolRegisterRequest extends JsonRpcRequest {
  method: 'tools/register';
  params: {
    tools: BTCPToolDefinition[];
  };
}

// ============================================================================
// Client Configuration Types
// ============================================================================

export interface BTCPClientConfig {
  serverUrl?: string;
  sessionId?: string;
  version?: string;
  autoReconnect?: boolean;
  reconnectDelay?: number;
  maxReconnectAttempts?: number;
  connectionTimeout?: number;
  debug?: boolean;
}

export interface BTCPClientEvents {
  connect: () => void;
  disconnect: (code: number, reason: string) => void;
  error: (error: Error) => void;
  message: (message: JsonRpcRequest | JsonRpcResponse | JsonRpcNotification) => void;
  toolCall: (request: BTCPToolCallRequest) => void;
  toolsList: (request: BTCPToolsListRequest) => void;
}

export type BTCPClientEventHandler<K extends keyof BTCPClientEvents> = BTCPClientEvents[K];

// ============================================================================
// Code-Mode Specific Types
// ============================================================================

export interface CodeModeConfig extends BTCPClientConfig {
  /** Timeout for code execution in milliseconds */
  executionTimeout?: number;
  /** Enable console log capture */
  captureConsole?: boolean;
  /** Maximum memory limit for VM (in bytes) */
  memoryLimit?: number;
}

export interface ToolNamespace {
  name: string;
  tools: BTCPToolDefinition[];
  interfaces: string;
}

export interface CodeExecutionResult {
  result: unknown;
  logs: string[];
  errors: string[];
  executionTime: number;
}

export interface ToolChainResult {
  result: unknown;
  logs: string[];
}

export interface RegisteredToolSource {
  name: string;
  type: 'btcp' | 'mcp' | 'http';
  tools: BTCPToolDefinition[];
  config?: Record<string, unknown>;
}

export interface ToolSearchResult {
  namespace: string;
  tool: BTCPToolDefinition;
  score: number;
}

// ============================================================================
// Tool Handler Types
// ============================================================================

export type ToolHandler = (
  args: Record<string, unknown>
) => Promise<BTCPContent[] | string | unknown>;

export interface ToolExecutorConfig {
  handlers?: Map<string, ToolHandler>;
  debug?: boolean;
}

// ============================================================================
// Error Classes
// ============================================================================

export class BTCPError extends Error {
  code: number;

  constructor(message: string, code: number = -32000) {
    super(message);
    this.name = 'BTCPError';
    this.code = code;
  }
}

export class BTCPConnectionError extends BTCPError {
  constructor(message: string) {
    super(message, -32001);
    this.name = 'BTCPConnectionError';
  }
}

export class BTCPValidationError extends BTCPError {
  constructor(message: string) {
    super(message, -32002);
    this.name = 'BTCPValidationError';
  }
}

export class BTCPExecutionError extends BTCPError {
  constructor(message: string) {
    super(message, -32003);
    this.name = 'BTCPExecutionError';
  }
}

export class BTCPToolNotFoundError extends BTCPError {
  constructor(toolName: string) {
    super(`Tool not found: ${toolName}`, -32004);
    this.name = 'BTCPToolNotFoundError';
  }
}

export class CodeExecutionError extends BTCPError {
  constructor(message: string) {
    super(message, -32005);
    this.name = 'CodeExecutionError';
  }
}

export class TimeoutError extends BTCPError {
  constructor(message: string = 'Execution timeout') {
    super(message, -32006);
    this.name = 'TimeoutError';
  }
}
