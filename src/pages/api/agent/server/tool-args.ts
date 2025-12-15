import type { ToolCallArgs } from "./types";

export const safeParseToolArgs = (
  rawArgs: string | undefined
):
  | { ok: true; value: ToolCallArgs }
  | { ok: false; error: string } => {
  try {
    const parsed = JSON.parse(rawArgs || "{}") as ToolCallArgs;
    return { ok: true, value: parsed };
  } catch (parseError) {
    const message =
      parseError instanceof Error ? parseError.message : "Invalid tool arguments";
    return { ok: false, error: message };
  }
};
