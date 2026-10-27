import type { Command } from "../shared/commands";

function splitArguments(args: string): string[] {
  const values: string[] = [];
  let value = "";
  let quote: string | null = null;
  let started = false;
  let escaped = false;
  for (const character of args) {
    if (escaped) {
      value += character;
      escaped = false;
      continue;
    }
    if (character === "\\" && quote !== "'") {
      escaped = true;
      started = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      else value += character;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      started = true;
      continue;
    }
    if (/\s/.test(character)) {
      if (started) {
        values.push(value);
        value = "";
        started = false;
      }
      continue;
    }
    value += character;
    started = true;
  }
  if (quote) throw new Error("Close the quoted argument before sending.");
  if (escaped) value += "\\";
  if (started) values.push(value);
  return values;
}

export function invocationText(
  command: Pick<Command, "name" | "mode">,
  body: string,
  args: string,
): string {
  const trimmed = args.trim();
  if (command.mode === "native") return `/${command.name}${trimmed ? ` ${trimmed}` : ""}`;
  if (!body.trim()) throw new Error("This command template is empty.");
  const values = splitArguments(trimmed);
  const named = new Map<string, string>();
  for (const value of values) {
    const assignment = /^([A-Z][A-Z0-9_]*)=(.*)$/s.exec(value);
    if (assignment) named.set(assignment[1], assignment[2]);
  }
  let substituted = false;
  const expanded = body.replace(
    /\$ARGUMENTS\b|\$([1-9][0-9]*)\b|\$([A-Z][A-Z0-9_]*)\b/g,
    (placeholder, position: string | undefined, name: string | undefined) => {
      if (placeholder === "$ARGUMENTS") {
        substituted = true;
        return trimmed;
      }
      if (position) {
        substituted = true;
        return values[Number(position) - 1] ?? "";
      }
      if (name && named.has(name)) {
        substituted = true;
        return named.get(name)!;
      }
      return placeholder;
    },
  );
  const appendArguments = trimmed.length > 0 && !substituted;
  const content = appendArguments ? `${expanded}\n\nArguments: ${trimmed}` : expanded;
  // A template beginning with '/' must remain text instead of invoking a different command.
  return `Run the following command template (${command.name}):\n\n${content}`;
}
