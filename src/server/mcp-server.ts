import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import { ZodError } from 'zod';

import { ElectronAdapter } from '../electron/electron-adapter.js';
import { type ElectronMcpError, ValidationError, normalizeError } from '../errors/index.js';
import type { Logger } from '../logging/logger.js';
import { SessionManager } from '../session/session-manager.js';
import { buildToolRegistry, type ToolContext } from '../tools/index.js';
import type { ServerConfig } from '../utils/config.js';
import { newRequestId } from '../utils/ids.js';

export interface ElectronMcpServer {
  server: Server;
  context: ToolContext;
  shutdown: () => Promise<void>;
}

export function createElectronMcpServer(config: ServerConfig, logger: Logger): ElectronMcpServer {
  const sessions = new SessionManager({ maxSessions: config.maxSessions, logger });
  const adapter = new ElectronAdapter(config, logger);
  const context: ToolContext = { config, logger, sessions, adapter };

  const server = new Server(
    {
      name: 'electron-mcp',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
        logging: {},
      },
    },
  );

  const registry = buildToolRegistry();
  const toolMap = new Map(registry.map((t) => [t.name, t]));

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: registry.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const requestId = newRequestId();
    const toolName = request.params.name;
    const rawArgs = request.params.arguments ?? {};

    const reqLogger = logger.child({ tool: toolName, requestId });
    const startedAt = Date.now();
    reqLogger.info('tool.call.begin');

    const tool = toolMap.get(toolName);
    if (!tool) {
      reqLogger.warn('tool.call.unknown');
      return errorResult(
        new ValidationError(`Unknown tool: ${toolName}`, {
          available: registry.map((t) => t.name),
        }),
      );
    }

    try {
      const result = await tool.handler(rawArgs, context);
      const durationMs = Date.now() - startedAt;
      reqLogger.info('tool.call.end', { durationMs, ok: true });
      return successResult(result);
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      const normalized = normalizeZodOrElectron(err);
      reqLogger.error('tool.call.end', {
        durationMs,
        ok: false,
        code: normalized.code,
        message: normalized.message,
      });
      return errorResult(normalized);
    }
  });

  const shutdown = async (): Promise<void> => {
    logger.info('shutting down mcp server');
    await sessions.closeAll().catch((err: unknown) => {
      logger.warn('shutdown: error closing sessions', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
    try {
      await server.close();
    } catch (err) {
      logger.warn('shutdown: error closing server', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return { server, context, shutdown };
}

function successResult(payload: unknown): CallToolResult {
  const text = safeStringify(payload);
  return {
    content: [{ type: 'text', text }],
    isError: false,
  };
}

function errorResult(err: ElectronMcpError): CallToolResult {
  const text = safeStringify(err.toJSON());
  return {
    content: [{ type: 'text', text }],
    isError: true,
  };
}

function normalizeZodOrElectron(err: unknown): ElectronMcpError {
  if (err instanceof ZodError) {
    return new ValidationError('Invalid tool input', {
      issues: err.issues.map((e) => ({
        path: e.path.join('.'),
        message: e.message,
        code: e.code,
      })),
    });
  }
  return normalizeError(err);
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return JSON.stringify({
      ok: false,
      error: { code: 'internal_error', message: 'unserializable result' },
    });
  }
}
