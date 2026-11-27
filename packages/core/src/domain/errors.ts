import { isRecord } from "./validate.ts";

/**
 * The one line to show for a failure. `SqlError`'s own message is generic ("Failed to execute
 * statement"); its classified reason carries the driver's text, which is what earlier nf
 * versions printed.
 */
export function errorText(error: unknown): string {
  if (isRecord(error) && error["_tag"] === "SqlError" && isRecord(error["reason"])) {
    const reason = error["reason"];
    if (reason["cause"] instanceof Error && reason["cause"].message.length > 0)
      return reason["cause"].message;
    if (typeof reason["message"] === "string" && reason["message"].length > 0)
      return reason["message"];
  }
  if (isRecord(error) && typeof error["message"] === "string") return error["message"];
  return String(error);
}
