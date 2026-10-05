/**
 * What every server action returns. Error values are keys of messages.errors,
 * so the text stays in hu.json. `reauth` asks the form to open the code dialog
 * and resubmit (plan §1.3); the filled-in form is kept.
 */
import type { SeriesHit } from "@/lib/providers/akk";
import type { SearchHit, SymbolInfo } from "@/lib/providers/symbols";
import type { RefreshSummary } from "@/lib/refresh/run";

export type DownloadFile = { name: string; type: string; content: string };

export type ActionResult =
  | { ok: true; message?: string; file?: DownloadFile; refresh?: RefreshSummary; hits?: SearchHit[]; from?: "bet" | "yahoo"; betDown?: boolean; series?: SeriesHit[]; info?: SymbolInfo | null; saved?: { institutionId: string; accountId: string } }
  | { ok: false; reauth?: true; errors?: Record<string, string>; formError?: string };
