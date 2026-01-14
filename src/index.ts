/**
 * BTCP Code-Mode
 * Plug-and-play library to enable agents to call BTCP tools via code execution
 *
 * @example
 * ```typescript
 * import { BTCPClient } from '@btcp/client';
 * import { CodeMode } from '@btcp/code-mode';
 *
 * const client = new BTCPClient({ serverUrl: '...' });
 * const codeMode = new CodeMode();
 *
 * // Register tools with code-mode (not client)
 * codeMode.registerTools('github', githubTools, callGithubTool);
 *
 * // Install code-mode tools to client
 * codeMode.install(client);
 *
 * await client.connect();
 * ```
 *
 * @packageDocumentation
 */

// Main export
export { CodeMode, createCodeMode } from './code-mode.js';
export type {
  CodeModeConfig,
  ToolCaller,
  ToolSource,
  ToolClient,
} from './code-mode.js';

// Sandbox
export { Sandbox, createSandbox } from './sandbox.js';
export type { SandboxOptions, SandboxContext } from './sandbox.js';

// Executor
export { ToolExecutor, createToolWrappers } from './executor.js';

// Interface generator
export {
  generateNamespaceInterface,
  generateCombinedInterfaces,
  generateCompactInterface,
} from './interface-generator.js';

// Protocol utilities
export {
  generateMessageId,
  createRequest,
  createResponse,
  createErrorResponse,
  createNotification,
  createTextContent,
  createImageContent,
  createResourceContent,
  createToolCallResponse,
  createToolCallErrorResponse,
  parseMessage,
  isRequest,
  isResponse,
  isNotification,
  serializeMessage,
  normalizeContent,
} from './protocol.js';

// Types
export type {
  // JSON-RPC types
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcError,
  JsonRpcNotification,

  // JSON Schema
  JsonSchema,

  // BTCP Tool types
  BTCPToolDefinition,
  BTCPToolExample,
  BTCPContent,

  // BTCP Message types
  BTCPMessageType,
  BTCPToolsListRequest,
  BTCPToolsListResponse,
  BTCPToolCallRequest,
  BTCPToolCallResponse,
  BTCPToolRegisterRequest,

  // Code-mode specific
  ToolNamespace,
  CodeExecutionResult,
  ToolChainResult,
  ToolSearchResult,

  // Executor types
  ToolHandler,
  ToolExecutorConfig,
} from './types.js';

// Error classes
export {
  BTCPError,
  BTCPConnectionError,
  BTCPValidationError,
  BTCPExecutionError,
  BTCPToolNotFoundError,
  CodeExecutionError,
  TimeoutError,
} from './types.js';
