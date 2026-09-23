// server/src/scripts/invite.ts
// Usage: npm run invite            → prints a new invite code
//        npm run invite -- --admin → same, and the member who redeems it becomes admin (first member bootstrap)
import { generateInviteCode } from "../auth/invites.js";
import * as repo from "../db/repo.js";

const code = generateInviteCode();
await repo.createInvite(null, code);
console.log(code);
if (process.argv.includes("--admin"))
  console.log("(first sign-in with this code should be promoted with: UPDATE members SET is_admin = true WHERE github_login = '<you>';)");
process.exit(0);
