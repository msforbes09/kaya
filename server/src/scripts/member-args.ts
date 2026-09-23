export type MemberTarget = { login: string } | { all: true };
export type MemberArgs = { ok: true; target: MemberTarget } | { ok: false; error: string };

/** Pure argument parsing shared by the member scripts. Neither wiping memory nor signing out is something to guess at. */
export function parseMemberArgs(argv: string[], script: string): MemberArgs {
  const usage = `usage: npm run ${script} -- --login <github_login> | --all`;
  const all = argv.includes("--all");
  const i = argv.indexOf("--login");
  const login = i >= 0 ? argv[i + 1] : undefined;
  if (all && i >= 0) return { ok: false, error: `pick one of --login or --all. ${usage}` };
  if (all) return { ok: true, target: { all: true } };
  if (i >= 0 && login && !login.startsWith("--")) return { ok: true, target: { login } };
  return { ok: false, error: usage };
}
