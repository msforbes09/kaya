// server/src/scripts/forget.ts
// Usage: npm run forget -- --login <github_login>   → wipes that member's memories and conversations
//        npm run forget -- --all                    → wipes them for every member
// Members, invites, and paired runners are untouched; nobody has to sign in or pair again.
import * as repo from "../db/repo.js";
import { parseForgetArgs } from "./forget-args.js";

const args = parseForgetArgs(process.argv.slice(2));
if (!args.ok) {
  console.error(args.error);
  process.exit(2);
}
if ("all" in args.target) {
  const n = await repo.forgetAll();
  console.log(`Forgot everything for ${n} member(s).`);
} else {
  const member = await repo.findMemberByLogin(args.target.login);
  if (!member) {
    console.error(`No member with login ${args.target.login}`);
    process.exit(1);
  }
  await repo.forgetMember(member.id);
  console.log(`Forgot everything for ${member.githubLogin}.`);
}
process.exit(0);
