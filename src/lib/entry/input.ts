/**
 * The simple form's state (4c plan §2): everything as typed, plain strings, so
 * the form can send it as one JSON field and get it back unchanged after a
 * code re-entry. The builder (build.ts) checks the meaning of every field.
 */
import { z } from "zod";

export const ENTRY_TABS = ["buy", "sell"] as const;
export type EntryTab = (typeof ENTRY_TABS)[number];
/** Vétel (spec 2026-09-28 §3.4): take the account's cash first, or bring all of it in. */
export const PAY_FROM = ["cash", "deposit"] as const;
export type PayFrom = (typeof PAY_FROM)[number];
/** Eladás: the money stays on the account, or it was taken out. */
export const PROCEEDS = ["keep", "withdraw"] as const;
export type Proceeds = (typeof PROCEEDS)[number];

export type InstrumentInput = {
  /** existing: `id`; yahoo: a search hit's `symbol`; bet: a BÉT search hit's code in `symbol`; akk: a series from the ÁKK list in `symbol`; manual: a new manual-valued item. */
  mode: "existing" | "yahoo" | "bet" | "akk" | "manual";
  id: string;
  symbol: string;
  name: string;
  currency: string;
  assetClass: string;
};

export type EntryInput = {
  tab: EntryTab;
  institution: { mode: "existing" | "new"; id: string; name: string };
  /** A new account starts the day before its first buy (build.ts). */
  account: { mode: "existing" | "new"; id: string; name: string; accountType: string };
  date: string;
  instrument: InstrumentInput;
  quantity: string;
  price: string;
  total: string;
  fee: string;
  /** Manual-valued items: the amount paid in or taken out, and the new total. */
  amount: string;
  newValue: string;
  /** Vétel: where the money came from; the amount is always the server's. */
  payFrom: PayFrom;
  /** Eladás: where the money went. */
  proceeds: Proceeds;
  note: string;
};

export const emptyInstrument = (): InstrumentInput => ({ mode: "existing", id: "", symbol: "", name: "", currency: "", assetClass: "" });

export function emptyEntryInput(): EntryInput {
  return {
    tab: "buy",
    institution: { mode: "existing", id: "", name: "" },
    account: { mode: "existing", id: "", name: "", accountType: "normal" },
    date: "",
    instrument: emptyInstrument(),
    quantity: "",
    price: "",
    total: "",
    fee: "",
    amount: "",
    newValue: "",
    payFrom: "cash",
    proceeds: "keep",
    note: "",
  };
}

const str = z.string().max(600).default("");
const instrument = z.object({
  mode: z.enum(["existing", "yahoo", "bet", "akk", "manual"]).default("existing"),
  id: str,
  symbol: str,
  name: str,
  currency: str,
  assetClass: str,
});

const schema = z.object({
  tab: z.enum(ENTRY_TABS),
  institution: z.object({ mode: z.enum(["existing", "new"]), id: str, name: str }),
  account: z.object({ mode: z.enum(["existing", "new"]), id: str, name: str, accountType: str }),
  date: str,
  instrument: instrument.default(emptyInstrument()),
  quantity: str,
  price: str,
  total: str,
  fee: str,
  amount: str,
  newValue: str,
  payFrom: z.enum(PAY_FROM).default("cash"),
  proceeds: z.enum(PROCEEDS).default("keep"),
  note: str,
});

/** The JSON field of the form, or null when it is not the form's shape. */
export function parseEntryInput(raw: unknown): EntryInput | null {
  if (typeof raw !== "string" || raw.length > 200_000) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const r = schema.safeParse(json);
  return r.success ? r.data : null;
}
