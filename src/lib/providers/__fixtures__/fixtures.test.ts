import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Recorded by `npm run spike -- --save` (phase 0). The adapters written in
// phase 4 parse these files, so they must stay intact and well-formed.
const dir = path.dirname(new URL(import.meta.url).pathname);
const read = (file: string) => readFileSync(path.join(dir, file), "utf8");

describe("recorded source fixtures", () => {
  it("MNB: SOAP response with daily rates and per-unit info", () => {
    const xml = read("mnb-get-exchange-rates.xml");
    expect(xml).toContain("GetExchangeRatesResult");
    expect(xml).toMatch(/Day date=&quot;|Day date="/);
    // JPY is quoted per 100 units: the adapter must normalise (plan §3.1).
    expect(xml).toMatch(/unit="100" curr="JPY"/);
  });

  it("ECB: Frankfurter range response based on EUR", () => {
    const json = JSON.parse(read("ecb-frankfurter-range.json"));
    expect(json.base).toBe("EUR");
    expect(Object.keys(json.rates).length).toBeGreaterThan(0);
  });

  it("Yahoo: one quote per probed symbol with currency", () => {
    const quotes = JSON.parse(read("yahoo-quotes.json")) as Array<{ symbol: string; currency: string }>;
    expect(quotes.map((q) => q.symbol).sort()).toEqual(["AAPL", "OTP.BD", "VWCE.DE"]);
    expect(quotes.every((q) => q.currency)).toBe(true);
  });

  it("ÁKK: price rows carry series, type, maturity, bid price and accrued interest", () => {
    const { data } = JSON.parse(read("akk-get-prices-map.json")) as { data: Array<Record<string, string>> };
    const pmap = data.find((r) => r.name === "2027/J");
    expect(pmap).toMatchObject({ securityType: "PMÁP", maturityDate: "2027.01.27" });
    for (const key of ["bidPrice", "accruedInterest", "issueDate", "longName"]) expect(pmap).toHaveProperty(key);
  });

  it("ÁKK, whole tabs and the interest history (2026-09-28): intact, with every retail type", () => {
    type Rows = { data: { data: Array<Record<string, string>> } };
    const map = JSON.parse(read("akk-full-map.json")) as Rows;
    const mapp = JSON.parse(read("akk-full-mapp.json")) as Rows;
    const rates = JSON.parse(read("akk-full-rates.json")) as Rows;
    expect(new Set(map.data.data.map((r) => r.securityType))).toEqual(new Set(["KTV", "FixMÁP", "PMÁP", "BMÁP"]));
    expect(new Set(mapp.data.data.map((r) => r.securityType))).toEqual(new Set(["MÁP Plusz", "MÁPP_T"]));
    expect(new Set(rates.data.data.map((r) => r.place))).toEqual(new Set(["BMAP", "PMAP", "FIX_MAP", "MAPP"]));
  });

  it("BAMOSZ: CSV has the daily header and dated rows", () => {
    const lines = read("bamosz-HU0000702022.csv").split("\n");
    const header = lines.findIndex((l) => l.startsWith('"Dátum","Árfolyam"'));
    expect(header).toBeGreaterThan(0);
    expect(lines[header + 1]).toMatch(/^"\d{4}\/\d{2}\/\d{2}","[\d,]+"/);
  });
});
