/**
 * BTCP Protocol Utilities
 * JSON-RPC 2.0 message handling for Browser Tool Calling Protocol
 */

import {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcError,
  JsonRpcNotification,
  BTCPContent,
  BTCPError,
} from './types.js';

let messageIdCounter = 0;

/**
 * Generate a unique message ID
 */
export function generateMessageId(): string {
  return `btcp-${Date.now()}-${++messageIdCounter}`;
}

/**
 * Create a JSON-RPC 2.0 request
 */
export function createRequest(
  method: string,
  params?: Record<string, unknown>
): JsonRpcRequest {
  return {
    jsonrpc: '2.0',
    id: generateMessageId(),
    method,
    ...(params && { params }),
  };
}

/**
 * Create a JSON-RPC 2.0 response
 */
export function createResponse(
  id: string | number,
  result?: unknown,
  error?: JsonRpcError
): JsonRpcResponse {
  const response: JsonRpcResponse = {
    jsonrpc: '2.0',
    id,
  };

  if (error) {
    response.error = error;
  } else {
    response.result = result;
  }

  return response;
}

/**
 * Create a JSON-RPC 2.0 error response
 */
export function createErrorResponse(
  id: string | number,
  code: number,
  message: string,
  data?: unknown
): JsonRpcResponse {
  const error: JsonRpcError = { code, message };
  if (data !== undefined) {
    error.data = data;
  }
  return createResponse(id, undefined, error);
}

/**
 * Create a JSON-RPC 2.0 notification (no response expected)
 */
export function createNotification(
  method: string,
  params?: Record<string, unknown>
): JsonRpcNotification {
  return {
    jsonrpc: '2.0',
    method,
    ...(params && { params }),
  };
}

/**
 * Create text content
 */
export function createTextContent(text: string): BTCPContent {
  return {
    type: 'text',
    text,
  };
}

/**
 * Create image content
 */
export function createImageContent(
  data: string,
  mimeType: string = 'image/png'
): BTCPContent {
  return {
    type: 'image',
    data,
    mimeType,
  };
}

/**
 * Create resource content
 */
export function createResourceContent(
  uri: string,
  text?: string,
  mimeType?: string
): BTCPContent {
  return {
    type: 'resource',
    uri,
    ...(text && { text }),
    ...(mimeType && { mimeType }),
  };
}

/**
 * Create a tool call response
 */
export function createToolCallResponse(
  id: string | number,
  content: BTCPContent[]
): JsonRpcResponse {
  return createResponse(id, { content, isError: false });
}

/**
 * Create a tool call error response
 */
export function createToolCallErrorResponse(
  id: string | number,
  error: Error | string | BTCPError
): JsonRpcResponse {
  let errorMessage: string;
  let errorCode: number = -32000;

  if (typeof error === 'string') {
    errorMessage = error;
  } else if (error instanceof BTCPError) {
    errorMessage = error.message;
    errorCode = error.code;
  } else {
    errorMessage = error.message;
  }

  return createResponse(id, {
    content: [createTextContent(errorMessage)],
    isError: true,
  });
}

/**
 * Parse a JSON-RPC message
 */
export function parseMessage(
  data: string
): JsonRpcRequest | JsonRpcResponse | JsonRpcNotification | null {
  try {
    const parsed = JSON.parse(data);

    // Validate JSON-RPC 2.0 format
    if (parsed.jsonrpc !== '2.0') {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

/**
 * Check if message is a request
 */
export function isRequest(
  message: JsonRpcRequest | JsonRpcResponse | JsonRpcNotification
): message is JsonRpcRequest {
  return 'method' in message && 'id' in message;
}

/**
 * Check if message is a response
 */
export function isResponse(
  message: JsonRpcRequest | JsonRpcResponse | JsonRpcNotification
): message is JsonRpcResponse {
  return 'id' in message && !('method' in message);
}

/**
 * Check if message is a notification
 */
export function isNotification(
  message: JsonRpcRequest | JsonRpcResponse | JsonRpcNotification
): message is JsonRpcNotification {
  return 'method' in message && !('id' in message);
}

/**
 * Serialize a message to JSON
 */
export function serializeMessage(
  message: JsonRpcRequest | JsonRpcResponse | JsonRpcNotification
): string {
  return JSON.stringify(message);
}

/**
 * Normalize content to BTCPContent array
 */
export function normalizeContent(value: unknown): BTCPContent[] {
  if (Array.isArray(value)) {
    // Check if it's already BTCPContent array
    if (value.length > 0 && typeof value[0] === 'object' && 'type' in value[0]) {
      return value as BTCPContent[];
    }
    return [createTextContent(JSON.stringify(value))];
  }

  if (typeof value === 'string') {
    // Check if it's base64 image data
    if (value.startsWith('data:image/')) {
      const match = value.match(/^data:(image\/[^;]+);base64,(.+)$/);
      if (match) {
        return [createImageContent(match[2], match[1])];
      }
    }
    return [createTextContent(value)];
  }

  if (typeof value === 'object' && value !== null) {
    // Check if it's BTCPContent
    if ('type' in value && ['text', 'image', 'resource'].includes((value as BTCPContent).type)) {
      return [value as BTCPContent];
    }
    return [createTextContent(JSON.stringify(value, null, 2))];
  }

  return [createTextContent(String(value))];
}
