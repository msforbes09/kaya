import { pgTable, text, timestamp, uuid, jsonb, vector, index } from "drizzle-orm/pg-core";

/**
 * One row per conversation with Kaya. `agentSessionId` is the Claude Agent SDK
 * session we resume so the agent keeps its own context between turns.
 */
export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentSessionId: text("agent_session_id"),
  title: text("title"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/** Transcript we own, independent of the SDK's on-disk session files. */
export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .references(() => conversations.id, { onDelete: "cascade" })
      .notNull(),
    role: text("role", { enum: ["user", "assistant", "tool"] }).notNull(),
    content: text("content").notNull(),
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("messages_conversation_idx").on(t.conversationId, t.createdAt)],
);

/**
 * Long-term memory the agent writes to explicitly via the `remember` tool:
 * project facts, decisions, conventions. The embedding column is nullable so
 * v1 works with plain text search; embeddings come when recall needs them.
 */
export const memories = pgTable(
  "memories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind", { enum: ["fact", "decision", "preference", "project"] }).notNull(),
    subject: text("subject").notNull(),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: 1024 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("memories_subject_idx").on(t.subject)],
);
