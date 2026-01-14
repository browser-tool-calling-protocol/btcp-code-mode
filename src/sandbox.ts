/**
 * VM Sandbox for Code Execution
 * Provides secure, isolated execution environment for tool chain code
 */

import * as vm from 'node:vm';
import { CodeExecutionResult, CodeExecutionError, TimeoutError } from './types.js';

export interface SandboxOptions {
  /** Execution timeout in milliseconds */
  timeout?: number;
  /** Memory limit in bytes (not enforced in pure Node.js, for documentation) */
  memoryLimit?: number;
  /** Enable console capture */
  captureConsole?: boolean;
  /** Additional globals to inject */
  globals?: Record<string, unknown>;
}

export interface SandboxContext {
  /** Tool namespace functions */
  [namespace: string]: Record<string, (args: Record<string, unknown>) => Promise<unknown>>;
}

const DEFAULT_OPTIONS: Required<SandboxOptions> = {
  timeout: 30000,
  memoryLimit: 128 * 1024 * 1024, // 128MB
  captureConsole: true,
  globals: {},
};

/**
 * Create a sandboxed execution environment
 */
export class Sandbox {
  private options: Required<SandboxOptions>;
  private toolFunctions: Map<string, Map<string, (args: Record<string, unknown>) => Promise<unknown>>>;
  private interfaces: Map<string, string>;

  constructor(options: SandboxOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.toolFunctions = new Map();
    this.interfaces = new Map();
  }

  /**
   * Register a namespace with its tool functions
   */
  registerNamespace(
    namespace: string,
    tools: Map<string, (args: Record<string, unknown>) => Promise<unknown>>,
    interfaceDefinition: string
  ): void {
    this.toolFunctions.set(namespace, tools);
    this.interfaces.set(namespace, interfaceDefinition);
  }

  /**
   * Get all registered namespaces
   */
  getNamespaces(): string[] {
    return Array.from(this.toolFunctions.keys());
  }

  /**
   * Get interface definition for a namespace
   */
  getInterface(namespace: string): string | undefined {
    return this.interfaces.get(namespace);
  }

  /**
   * Execute code in the sandbox
   */
  async execute(code: string, timeout?: number): Promise<CodeExecutionResult> {
    const executionTimeout = timeout ?? this.options.timeout;
    const logs: string[] = [];
    const errors: string[] = [];
    const startTime = Date.now();

    // Create console capture
    const capturedConsole = this.createCapturedConsole(logs, errors);

    // Build context with tool namespaces
    const context = this.buildContext(capturedConsole);

    // Add introspection capabilities
    context.__interfaces = this.getNamespaces();
    context.__getToolInterface = (toolPath: string) => {
      const [namespace] = toolPath.split('.');
      return this.interfaces.get(namespace) || null;
    };

    // Create VM context
    const vmContext = vm.createContext(context, {
      name: 'btcp-code-mode-sandbox',
    });

    // Wrap the code to handle async execution
    const wrappedCode = `
      (async () => {
        ${code}
      })()
    `;

    try {
      // Compile and run the script
      const script = new vm.Script(wrappedCode, {
        filename: 'code-mode-execution.js',
      });

      const resultPromise = script.runInContext(vmContext, {
        timeout: executionTimeout,
        breakOnSigint: true,
      });

      // Handle async result
      const result = await Promise.race([
        resultPromise,
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new TimeoutError(`Execution timeout after ${executionTimeout}ms`)),
            executionTimeout
          )
        ),
      ]);

      return {
        result,
        logs,
        errors,
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push(errorMessage);

      if (error instanceof TimeoutError) {
        throw error;
      }

      throw new CodeExecutionError(`Code execution failed: ${errorMessage}`);
    }
  }

  /**
   * Create captured console object
   */
  private createCapturedConsole(
    logs: string[],
    errors: string[]
  ): Pick<Console, 'log' | 'info' | 'warn' | 'error' | 'debug' | 'trace' | 'dir' | 'table' | 'time' | 'timeEnd' | 'timeLog' | 'assert' | 'clear' | 'count' | 'countReset' | 'group' | 'groupCollapsed' | 'groupEnd'> {
    const formatArgs = (...args: unknown[]): string => {
      return args
        .map((arg) => {
          if (typeof arg === 'object') {
            try {
              return JSON.stringify(arg, null, 2);
            } catch {
              return String(arg);
            }
          }
          return String(arg);
        })
        .join(' ');
    };

    return {
      log: (...args: unknown[]) => { logs.push(formatArgs(...args)); },
      info: (...args: unknown[]) => { logs.push(`[INFO] ${formatArgs(...args)}`); },
      warn: (...args: unknown[]) => { logs.push(`[WARN] ${formatArgs(...args)}`); },
      error: (...args: unknown[]) => { errors.push(formatArgs(...args)); },
      debug: (...args: unknown[]) => { logs.push(`[DEBUG] ${formatArgs(...args)}`); },
      trace: (...args: unknown[]) => { logs.push(`[TRACE] ${formatArgs(...args)}`); },
      dir: (obj: unknown) => { logs.push(JSON.stringify(obj, null, 2)); },
      table: (data: unknown) => { logs.push(JSON.stringify(data, null, 2)); },
      time: () => {},
      timeEnd: () => {},
      timeLog: () => {},
      assert: (condition: unknown, ...args: unknown[]) => {
        if (!condition) {
          errors.push(`Assertion failed: ${formatArgs(...args)}`);
        }
      },
      clear: () => {},
      count: () => {},
      countReset: () => {},
      group: () => {},
      groupCollapsed: () => {},
      groupEnd: () => {},
    };
  }

  /**
   * Build execution context with tool namespaces
   */
  private buildContext(console: Pick<Console, 'log' | 'info' | 'warn' | 'error' | 'debug' | 'trace' | 'dir' | 'table' | 'time' | 'timeEnd' | 'timeLog' | 'assert' | 'clear' | 'count' | 'countReset' | 'group' | 'groupCollapsed' | 'groupEnd'>): Record<string, unknown> {
    const context: Record<string, unknown> = {
      console,
      JSON,
      Math,
      Date,
      String,
      Number,
      Boolean,
      Array,
      Object,
      Map,
      Set,
      WeakMap,
      WeakSet,
      Promise,
      Symbol,
      RegExp,
      Error,
      TypeError,
      RangeError,
      SyntaxError,
      URIError,
      EvalError,
      ReferenceError,
      parseInt,
      parseFloat,
      isNaN,
      isFinite,
      encodeURI,
      decodeURI,
      encodeURIComponent,
      decodeURIComponent,
      atob: globalThis.atob,
      btoa: globalThis.btoa,
      // Add async utilities
      setTimeout: (fn: () => void, ms: number) => {
        // Simplified timeout for sandbox
        return new Promise<void>((resolve) => {
          const timer = globalThis.setTimeout(() => {
            fn();
            resolve();
          }, ms);
          return timer;
        });
      },
      // Additional globals
      ...this.options.globals,
    };

    // Add tool namespaces
    for (const [namespace, tools] of this.toolFunctions) {
      const namespaceObj: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {};
      for (const [toolName, toolFn] of tools) {
        namespaceObj[toolName] = toolFn;
      }
      context[namespace] = namespaceObj;
    }

    return context;
  }

  /**
   * Clear all registered namespaces
   */
  clear(): void {
    this.toolFunctions.clear();
    this.interfaces.clear();
  }
}

/**
 * Create a new sandbox instance
 */
export function createSandbox(options?: SandboxOptions): Sandbox {
  return new Sandbox(options);
}
