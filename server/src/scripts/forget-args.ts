export type ForgetTarget = { login: string } | { all: true };
export type ForgetArgs = { ok: true; target: ForgetTarget } | { ok: false; error: string };

const USAGE = "usage: npm run forget -- --login <github_login> | --all";

/** Pure argument parsing for the forget script. Wiping memory is not something to guess at. */
export function parseForgetArgs(argv: string[]): ForgetArgs {
  const all = argv.includes("--all");
  const i = argv.indexOf("--login");
  const login = i >= 0 ? argv[i + 1] : undefined;
  if (all && i >= 0) return { ok: false, error: `pick one of --login or --all. ${USAGE}` };
  if (all) return { ok: true, target: { all: true } };
  if (i >= 0 && login && !login.startsWith("--")) return { ok: true, target: { login } };
  return { ok: false, error: USAGE };
}
