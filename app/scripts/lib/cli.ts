type ParsedArgs = Record<string, string | boolean>;

/** Minimal `--flag value` / `--flag=value` / `--boolean` parser for local scripts. */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const args: ParsedArgs = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token || !token.startsWith("--")) continue;
    const withoutDashes = token.slice(2);
    const equalsIndex = withoutDashes.indexOf("=");
    if (equalsIndex !== -1) {
      args[withoutDashes.slice(0, equalsIndex)] = withoutDashes.slice(equalsIndex + 1);
      continue;
    }
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      args[withoutDashes] = next;
      index += 1;
    } else {
      args[withoutDashes] = true;
    }
  }
  return args;
}

export function requireStringArg(
  args: ParsedArgs,
  name: string,
  hint: string,
): string {
  const value = args[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(`Missing --${name}. ${hint}`);
  }
  return value.trim();
}

export function optionalStringArg(args: ParsedArgs, name: string): string | undefined {
  const value = args[name];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function fail(message: string): never {
  console.error(`✖ ${message}`);
  process.exit(1);
}

export function printHeader(title: string): void {
  console.log(`\n${title}`);
  console.log("─".repeat(title.length));
}

export function printStep(message: string): void {
  console.log(`• ${message}`);
}

export function printDone(message: string): void {
  console.log(`✔ ${message}`);
}
