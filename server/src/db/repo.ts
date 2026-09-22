import { eq, desc, ilike, or } from "drizzle-orm";
import { db, schema } from "./client.js";

export async function createConversation() {
  const [row] = await db.insert(schema.conversations).values({}).returning();
  return row;
}

export async function getConversation(id: string) {
  return db.query.conversations.findFirst({ where: eq(schema.conversations.id, id) });
}

export async function setAgentSession(conversationId: string, agentSessionId: string) {
  await db
    .update(schema.conversations)
    .set({ agentSessionId, updatedAt: new Date() })
    .where(eq(schema.conversations.id, conversationId));
}

export async function addMessage(
  conversationId: string,
  role: "user" | "assistant" | "tool",
  content: string,
  meta?: Record<string, unknown>,
) {
  await db.insert(schema.messages).values({ conversationId, role, content, meta });
}

export async function recentMessages(conversationId: string, limit = 50) {
  return db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.conversationId, conversationId))
    .orderBy(desc(schema.messages.createdAt))
    .limit(limit);
}

export async function remember(kind: (typeof schema.memories.$inferInsert)["kind"], subject: string, content: string) {
  const [row] = await db.insert(schema.memories).values({ kind, subject, content }).returning();
  return row;
}

/** v1 recall: case-insensitive substring match on subject/content. Swap for pgvector later. */
export async function recall(query: string, limit = 10) {
  const like = `%${query}%`;
  return db
    .select()
    .from(schema.memories)
    .where(or(ilike(schema.memories.subject, like), ilike(schema.memories.content, like)))
    .orderBy(desc(schema.memories.createdAt))
    .limit(limit);
}
