/**
 * Interface Generator
 * Generates TypeScript interfaces from BTCP tool definitions
 */

import { BTCPToolDefinition, JsonSchema } from './types.js';

/**
 * Generate TypeScript interface from JSON Schema
 */
function schemaToTypeScript(schema: JsonSchema, indent: number = 2): string {
  const indentStr = ' '.repeat(indent);

  if (!schema.type) {
    if (schema.oneOf || schema.anyOf) {
      const schemas = schema.oneOf || schema.anyOf || [];
      return schemas.map((s) => schemaToTypeScript(s, indent)).join(' | ');
    }
    if (schema.allOf) {
      return schema.allOf.map((s) => schemaToTypeScript(s, indent)).join(' & ');
    }
    return 'unknown';
  }

  // Handle array types
  if (Array.isArray(schema.type)) {
    return schema.type.map((t) => jsonTypeToTS(t)).join(' | ');
  }

  switch (schema.type) {
    case 'string':
      if (schema.enum) {
        return schema.enum.map((e) => JSON.stringify(e)).join(' | ');
      }
      return 'string';

    case 'number':
    case 'integer':
      if (schema.enum) {
        return schema.enum.map((e) => String(e)).join(' | ');
      }
      return 'number';

    case 'boolean':
      return 'boolean';

    case 'null':
      return 'null';

    case 'array':
      if (schema.items) {
        if (Array.isArray(schema.items)) {
          return `[${schema.items.map((i) => schemaToTypeScript(i, indent)).join(', ')}]`;
        }
        return `${schemaToTypeScript(schema.items, indent)}[]`;
      }
      return 'unknown[]';

    case 'object':
      if (!schema.properties) {
        if (schema.additionalProperties) {
          if (typeof schema.additionalProperties === 'boolean') {
            return 'Record<string, unknown>';
          }
          return `Record<string, ${schemaToTypeScript(schema.additionalProperties, indent)}>`;
        }
        return 'Record<string, unknown>';
      }

      const required = new Set(schema.required || []);
      const props = Object.entries(schema.properties)
        .map(([key, propSchema]) => {
          const optional = required.has(key) ? '' : '?';
          const description = propSchema.description
            ? `${indentStr}/** ${propSchema.description} */\n`
            : '';
          return `${description}${indentStr}${key}${optional}: ${schemaToTypeScript(propSchema, indent + 2)};`;
        })
        .join('\n');

      return `{\n${props}\n${' '.repeat(Math.max(0, indent - 2))}}`;

    default:
      return 'unknown';
  }
}

/**
 * Convert JSON type to TypeScript type
 */
function jsonTypeToTS(type: string): string {
  switch (type) {
    case 'string':
      return 'string';
    case 'number':
    case 'integer':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'null':
      return 'null';
    case 'array':
      return 'unknown[]';
    case 'object':
      return 'Record<string, unknown>';
    default:
      return 'unknown';
  }
}

/**
 * Sanitize tool name to be a valid TypeScript identifier
 */
function sanitizeIdentifier(name: string): string {
  // Replace invalid characters with underscores
  let sanitized = name.replace(/[^a-zA-Z0-9_$]/g, '_');

  // Ensure it doesn't start with a number
  if (/^[0-9]/.test(sanitized)) {
    sanitized = '_' + sanitized;
  }

  return sanitized;
}

/**
 * Generate interface name from tool name
 */
function generateInterfaceName(toolName: string): string {
  const sanitized = sanitizeIdentifier(toolName);
  return sanitized.charAt(0).toUpperCase() + sanitized.slice(1) + 'Input';
}

/**
 * Generate TypeScript interfaces for a namespace of tools
 */
export function generateNamespaceInterface(
  namespace: string,
  tools: BTCPToolDefinition[]
): string {
  const sanitizedNamespace = sanitizeIdentifier(namespace);
  const lines: string[] = [];

  lines.push(`/**`);
  lines.push(` * Namespace: ${namespace}`);
  lines.push(` * Auto-generated TypeScript interfaces for BTCP tools`);
  lines.push(` */`);
  lines.push(``);
  lines.push(`declare namespace ${sanitizedNamespace} {`);

  for (const tool of tools) {
    const interfaceName = generateInterfaceName(tool.name);
    const sanitizedToolName = sanitizeIdentifier(tool.name);

    // Add tool description
    lines.push(``);
    lines.push(`  /**`);
    lines.push(`   * ${tool.description}`);
    if (tool.deprecated) {
      lines.push(`   * @deprecated`);
    }
    lines.push(`   */`);

    // Generate input interface
    lines.push(`  interface ${interfaceName} ${schemaToTypeScript(tool.inputSchema, 4)}`);

    // Generate function signature
    lines.push(``);
    lines.push(`  /**`);
    lines.push(`   * ${tool.description}`);
    if (tool.examples && tool.examples.length > 0) {
      lines.push(`   * @example`);
      lines.push(`   * \`\`\``);
      lines.push(`   * const result = await ${sanitizedNamespace}.${sanitizedToolName}(${JSON.stringify(tool.examples[0].input)});`);
      lines.push(`   * \`\`\``);
    }
    lines.push(`   */`);
    lines.push(`  function ${sanitizedToolName}(input: ${interfaceName}): Promise<unknown>;`);
  }

  lines.push(`}`);
  lines.push(``);

  return lines.join('\n');
}

/**
 * Generate a combined interface document for multiple namespaces
 */
export function generateCombinedInterfaces(
  namespaces: Map<string, BTCPToolDefinition[]>
): string {
  const lines: string[] = [];

  lines.push(`/**`);
  lines.push(` * BTCP Code-Mode Auto-generated Interfaces`);
  lines.push(` * Generated at: ${new Date().toISOString()}`);
  lines.push(` */`);
  lines.push(``);

  for (const [namespace, tools] of namespaces) {
    lines.push(generateNamespaceInterface(namespace, tools));
  }

  return lines.join('\n');
}

/**
 * Generate a compact prompt-friendly interface summary
 */
export function generateCompactInterface(
  namespace: string,
  tools: BTCPToolDefinition[]
): string {
  const sanitizedNamespace = sanitizeIdentifier(namespace);
  const lines: string[] = [];

  lines.push(`// ${namespace} tools`);

  for (const tool of tools) {
    const sanitizedToolName = sanitizeIdentifier(tool.name);
    const params = generateCompactParams(tool.inputSchema);
    lines.push(`${sanitizedNamespace}.${sanitizedToolName}(${params}) - ${tool.description}`);
  }

  return lines.join('\n');
}

/**
 * Generate compact parameter representation
 */
function generateCompactParams(schema: JsonSchema): string {
  if (!schema.properties) {
    return '{}';
  }

  const required = new Set(schema.required || []);
  const params = Object.entries(schema.properties)
    .map(([key, propSchema]) => {
      const optional = required.has(key) ? '' : '?';
      const type = getCompactType(propSchema);
      return `${key}${optional}: ${type}`;
    })
    .join(', ');

  return `{ ${params} }`;
}

/**
 * Get compact type representation
 */
function getCompactType(schema: JsonSchema): string {
  if (!schema.type) {
    return 'any';
  }

  if (Array.isArray(schema.type)) {
    return schema.type.join(' | ');
  }

  switch (schema.type) {
    case 'string':
      return schema.enum ? schema.enum.map((e) => JSON.stringify(e)).join(' | ') : 'string';
    case 'number':
    case 'integer':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'array':
      return 'array';
    case 'object':
      return 'object';
    default:
      return 'any';
  }
}
