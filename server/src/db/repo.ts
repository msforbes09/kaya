import { and, desc, eq, ilike, isNull, or } from "drizzle-orm";
import { db, schema } from "./client.js";

// members
export async function findMemberByGithubId(githubId: number) {
  return db.query.members.findFirst({ where: eq(schema.members.githubId, githubId) });
}
export async function findMemberByLogin(login: string) {
  return db.query.members.findFirst({ where: eq(schema.members.githubLogin, login) });
}
export async function getMember(id: string) {
  return db.query.members.findFirst({ where: eq(schema.members.id, id) });
}
export async function createMember(u: { githubId: number; login: string; avatarUrl: string; isAdmin?: boolean }) {
  const [row] = await db
    .insert(schema.members)
    .values({ githubId: u.githubId, githubLogin: u.login, avatarUrl: u.avatarUrl, isAdmin: u.isAdmin ?? false })
    .returning();
  return row;
}

export async function deleteMember(id: string) {
  await db.delete(schema.members).where(eq(schema.members.id, id));
}

// invites
export async function createInvite(createdBy: string | null, code: string) {
  await db.insert(schema.invites).values({ code, createdBy });
}
/** Burns the code for this member. False if unknown or already used. */
export async function redeemInvite(code: string, memberId: string): Promise<boolean> {
  const rows = await db
    .update(schema.invites)
    .set({ usedBy: memberId, usedAt: new Date() })
    .where(and(eq(schema.invites.code, code), isNull(schema.invites.usedBy)))
    .returning();
  return rows.length === 1;
}
// pairing
export async function createPairingCode(code: string, runnerPublicId: string, expiresAt: Date) {
  await db.insert(schema.pairingCodes).values({ code, runnerPublicId, expiresAt });
}
export async function getPairingCode(code: string) {
  return db.query.pairingCodes.findFirst({ where: eq(schema.pairingCodes.code, code) });
}
export async function getPairingByPublicId(publicId: string) {
  return db.query.pairingCodes.findFirst({ where: eq(schema.pairingCodes.runnerPublicId, publicId) });
}
export async function confirmPairingCode(code: string, memberId: string): Promise<boolean> {
  const rows = await db
    .update(schema.pairingCodes)
    .set({ memberId })
    .where(and(eq(schema.pairingCodes.code, code), isNull(schema.pairingCodes.memberId)))
    .returning();
  return rows.length === 1;
}
export async function deletePairingCode(code: string) {
  await db.delete(schema.pairingCodes).where(eq(schema.pairingCodes.code, code));
}

// runners
export async function upsertRunner(r: { memberId: string; name: string; tokenHash: string; workspace: string }) {
  await db.delete(schema.runners).where(eq(schema.runners.memberId, r.memberId));
  const [row] = await db.insert(schema.runners).values(r).returning();
  return row;
}
export async function findRunnerByTokenHash(tokenHash: string) {
  return db.query.runners.findFirst({ where: eq(schema.runners.tokenHash, tokenHash) });
}
export async function touchRunner(id: string) {
  await db.update(schema.runners).set({ lastSeenAt: new Date() }).where(eq(schema.runners.id, id));
}

// conversations & messages
export async function createConversation(memberId: string) {
  const [row] = await db.insert(schema.conversations).values({ memberId }).returning();
  return row;
}
export async function getConversation(id: string, memberId: string) {
  return db.query.conversations.findFirst({
    where: and(eq(schema.conversations.id, id), eq(schema.conversations.memberId, memberId)),
  });
}
export async function setAgentSession(conversationId: string, agentSessionId: string, runnerId: string) {
  await db
    .update(schema.conversations)
    .set({ agentSessionId, runnerId, updatedAt: new Date() })
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

// memories (per member)
export async function remember(
  memberId: string,
  kind: (typeof schema.memories.$inferInsert)["kind"],
  subject: string,
  content: string,
) {
  const [row] = await db.insert(schema.memories).values({ memberId, kind, subject, content }).returning();
  return row;
}
export async function recall(memberId: string, query: string, limit = 10) {
  const like = `%${query}%`;
  return db
    .select()
    .from(schema.memories)
    .where(and(eq(schema.memories.memberId, memberId), or(ilike(schema.memories.subject, like), ilike(schema.memories.content, like))))
    .orderBy(desc(schema.memories.createdAt))
    .limit(limit);
}

/** Drops a member's memories and conversations (messages cascade). The member, invites, and runners stay. */
export async function forgetMember(memberId: string) {
  await db.transaction(async (tx) => {
    await tx.delete(schema.memories).where(eq(schema.memories.memberId, memberId));
    await tx.delete(schema.conversations).where(eq(schema.conversations.memberId, memberId));
  });
}
/** Same for every member. Returns how many members there are. */
export async function forgetAll(): Promise<number> {
  return db.transaction(async (tx) => {
    await tx.delete(schema.memories);
    await tx.delete(schema.conversations);
    const rows = await tx.select({ id: schema.members.id }).from(schema.members);
    return rows.length;
  });
}
