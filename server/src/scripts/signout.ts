// server/src/scripts/signout.ts
// Usage: npm run signout -- --login <github_login>   → every session cookie that member holds stops working
//        npm run signout -- --all                    → same for every member
// Paired runners keep working; only phone/browser sessions are signed out.
import * as repo from "../db/repo.js";
import { parseMemberArgs } from "./member-args.js";

const args = parseMemberArgs(process.argv.slice(2), "signout");
if (!args.ok) {
  console.error(args.error);
  process.exit(2);
}
if ("all" in args.target) {
  const n = await repo.revokeAllSessions();
  console.log(`Signed out ${n} member(s) everywhere.`);
} else {
  const member = await repo.findMemberByLogin(args.target.login);
  if (!member) {
    console.error(`No member with login ${args.target.login}`);
    process.exit(1);
  }
  await repo.revokeSessions(member.id);
  console.log(`Signed out ${member.githubLogin} everywhere.`);
}
process.exit(0);
