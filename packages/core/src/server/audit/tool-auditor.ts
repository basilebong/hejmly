import type { UserId } from "../../shared/index.ts";
import type { AuditRecorder } from "./recorder.ts";

export type ToolFailure<E> = {
  content: [{ type: "text"; text: string }];
  structuredContent: { error: E };
  isError: true;
};

export type ToolAuditor = {
  record(action: string, metadata: Record<string, unknown>): Promise<void>;
  failure<E extends { kind: string }>(
    action: string,
    error: E,
    text: string,
    metadata: Record<string, unknown>,
  ): Promise<ToolFailure<E>>;
};

export const createToolAuditor = ({
  audit,
  actor,
  app,
}: {
  audit: AuditRecorder;
  actor: UserId;
  app: string;
}): ToolAuditor => {
  const record = async (action: string, metadata: Record<string, unknown>): Promise<void> => {
    try {
      await audit.record({ userId: actor, action, via: "mcp", metadata });
    } catch (e) {
      console.error(`${app} audit failed`, e);
    }
  };

  return {
    record,
    async failure(action, error, text, metadata) {
      await record(action, { ...metadata, error: error.kind });
      return { content: [{ type: "text", text }], structuredContent: { error }, isError: true };
    },
  };
};
