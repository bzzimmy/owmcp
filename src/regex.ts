/** Case-insensitive regex from a tool argument: undefined if absent, an Error if invalid. */
export function parseRegex(source: string | undefined): RegExp | Error | undefined {
  if (source === undefined) return undefined;
  try {
    return new RegExp(source, "i");
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}
