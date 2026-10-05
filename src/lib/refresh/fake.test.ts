import { describe, expect, it } from "vitest";
import { observe } from "@/lib/bonds/observe";
import { addMonths } from "@/lib/bonds/rules";
import { addDays } from "@/lib/finance/money";
import { fakeAkk, fakeBet } from "./fake";

describe("fakeAkk: invented ÁKK series that follow the Horizon's own rules", () => {
  const today = "2026-09-28";

  it("a MÁP Plusz maturing today, a FixMÁP and a BMÁP with its history, on the right tabs", async () => {
    const akk = fakeAkk(today);
    const mapp = await akk.prices("MAPP");
    const map = await akk.prices("MAP");
    expect(mapp.map((r) => [r.series, r.securityType, r.maturity])).toEqual([["FAKE/M", "MÁPP_T", today]]);
    expect(map.map((r) => [r.series, r.securityType])).toEqual([["FAKE/F", "FixMÁP"], ["FAKE/B", "BMÁP"]]);
    expect(map.find((r) => r.series === "FAKE/F")?.maturity).toBe(addDays(addMonths(today, 36), -10));
    expect((await akk.rates()).every((r) => r.series === "FAKE/B")).toBe(true);
  });

  it("today is no interest day of theirs, so today's reading verifies each one (the matured one is not checked)", async () => {
    const akk = fakeAkk(today);
    const rates = await akk.rates();
    const rows = new Map((await akk.prices("MAP")).map((r) => [r.series, r]));
    for (const r of rows.values()) {
      const t = { instrumentId: r.series, name: r.series, series: r.series, kind: r.kind, tab: r.tab, issue: r.issue, maturity: r.maturity };
      expect(observe(t, rows, rates.filter((x) => x.series === r.series), today).check, r.series).toBe("verified");
    }
  });
});

describe("fakeAkk: any FAKE…/M, /F or /B series asked for, so parallel tests never share one", () => {
  it("answers the wanted series by their last letter, the history of a /B one included", async () => {
    const akk = fakeAkk("2026-09-28", ["fakex1/f", "FAKEX2/B", "FAKEX3/M", "2031/M5", "FAKE/Q"]);
    const all = [...(await akk.prices("MAP")), ...(await akk.prices("MAPP"))];
    expect(all.map((r) => [r.series, r.securityType]).filter(([s]) => s.startsWith("FAKEX"))).toEqual([
      ["FAKEX1/F", "FixMÁP"], ["FAKEX2/B", "BMÁP"], ["FAKEX3/M", "MÁPP_T"],
    ]);
    expect(all.some((r) => r.series === "2031/M5" || r.series === "FAKE/Q")).toBe(false);
    expect(new Set((await akk.rates()).map((r) => r.series))).toEqual(new Set(["FAKE/B", "FAKEX2/B"]));
  });
});

describe("fakeBet: invented BÉT papers (BETFAKE…), apart from the invented Yahoo's FAKE…", () => {
  it("lists BETFAKE and every BETFAKE… code asked for, nothing else", async () => {
    const bet = fakeBet("2026-09-28", ["betfakeab1", "FAKEX", "OTP"]);
    expect((await bet.papers()).map((p) => [p.code, p.assetClass])).toEqual([["BETFAKE", "stock"], ["BETFAKEAB1", "stock"]]);
  });

  it("a HUF close for every weekday before today: 1000 + the day of the month", async () => {
    const h = await fakeBet("2026-09-28").history("betfake", "2026-09-24", "2026-09-28");
    expect(h.currency).toBe("HUF");
    expect(h.bars.map((b) => [b.day, b.close.toFixed()])).toEqual([["2026-09-24", "1024"], ["2026-09-25", "1025"]]);
    expect(await fakeBet("2026-09-28").history("BETFAKE", "2026-09-26", "2026-09-27")).toEqual({ currency: null, bars: [] });
  });

  it("an unknown code is symbol_not_found", async () => {
    await expect(fakeBet("2026-09-28").history("FAKEX", "2026-09-24", "2026-09-28")).rejects.toMatchObject({ errorClass: "symbol_not_found" });
  });
});
