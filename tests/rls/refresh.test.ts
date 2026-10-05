/**
 * Phase 4a in the database: the refresh log, the bulk-insert RPCs, coverage
 * and the windowed price load. Rolled-back transactions, simulated actors.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { type PriceQuote, selectPrice } from "../../src/lib/finance/prices";
import { actors, type Scenario, withScenario } from "./harness";

// One Yahoo instrument per symbol and owner (4c): every call gets its own symbol.
async function ownerInstrument(s: Scenario, owner = s.fx.owner.userId) {
  const r = await s.admin(`insert into public.instruments (owner_id, name, asset_class, currency, price_source, provider_symbol)
                           values ($1, 'Teszt ETF', 'etf', 'EUR', 'yahoo', $2) returning id`, [owner, `TEST${randomUUID().slice(0, 8)}.DE`]);
  return r.rows[0].id as string;
}

// A BÉT paper (spec 2026-09-28 §2.6): one per code and owner, like Yahoo symbols.
async function betInstrument(s: Scenario, owner = s.fx.owner.userId, code = `TEST${randomUUID().slice(0, 8).toUpperCase()}`) {
  const r = await s.admin(`insert into public.instruments (owner_id, name, asset_class, currency, price_source, provider_symbol)
                           values ($1, $2, 'etf', 'EUR', 'bet', $2) returning id`, [owner, code]);
  return r.rows[0].id as string;
}

const fxRow = (base: string, quote: string, rate: string, rateDate: string, source = "MNB") => ({ base, quote, rate, rateDate, source, rawUnit: 1, status: "ok" });
const quoteRow = (instrumentId: string, price: string, asOf: string, status = "ok") => ({ instrumentId, price, currency: "EUR", asOf, source: "yahoo", status });

const DENIED = ["anon", "ownerAal1", "ownerUnapprovedFactor", "strangerAal2", "strangerStolenSession"] as const;

describe("refresh_log", () => {
  const insertLog = `insert into public.refresh_log (run_id, source, item, kind, range_from, range_to, status, inserted)
                     values ($1, 'MNB', 'EUR', 'tail', '2026-09-20', '2026-09-27', 'ok', 3) returning id`;

  it("the trusted owner appends and reads own rows; nobody updates or deletes", async () => {
    await withScenario(async (s) => {
      const a = actors(s.fx);
      const ins = await s.as(a.ownerTrusted, insertLog, [randomUUID()]);
      expect(ins.error).toBeUndefined();
      expect((await s.as(a.ownerTrusted, `select * from public.refresh_log`)).rows).toHaveLength(1);
      expect((await s.as(a.ownerTrusted, `update public.refresh_log set inserted = 0`)).error).toBe("42501");
      expect((await s.as(a.ownerTrusted, `delete from public.refresh_log`)).error).toBe("42501");
    });
  });

  it("denied actors see nothing and add nothing", async () => {
    await withScenario(async (s) => {
      const a = actors(s.fx);
      await s.as(a.ownerTrusted, insertLog, [randomUUID()]);
      for (const who of DENIED) {
        expect((await s.as(a[who], `select * from public.refresh_log`)).rows, who).toHaveLength(0);
        expect((await s.as(a[who], insertLog, [randomUUID()])).error, who).toBeDefined();
      }
    });
  });

  it("a message is an error class, never provider text", async () => {
    await withScenario(async (s) => {
      const a = actors(s.fx);
      const bad = await s.as(
        a.ownerTrusted,
        `insert into public.refresh_log (run_id, source, item, kind, status, message) values ($1, 'yahoo', 'x', 'live', 'error', 'Response: {"price": 1}')`,
        [randomUUID()],
      );
      expect(bad.error).toBe("23514");
      const noClass = await s.as(a.ownerTrusted, `insert into public.refresh_log (run_id, source, item, kind, status) values ($1, 'yahoo', 'x', 'live', 'error')`, [randomUUID()]);
      expect(noClass.error).toBe("23514");
    });
  });
});

describe("record_fx_rates / record_quotes", () => {
  it("insert once: a repeated call adds nothing", async () => {
    await withScenario(async (s) => {
      const a = actors(s.fx);
      const rows = [fxRow("EUR", "HUF", "364.42", "2031-01-02"), fxRow("USD", "HUF", "319.89", "2031-01-02")];
      const first = await s.as(a.ownerTrusted, `select public.record_fx_rates($1::jsonb) as n`, [JSON.stringify(rows)]);
      expect(first.rows[0].n).toBe(2);
      const again = await s.as(a.ownerTrusted, `select public.record_fx_rates($1::jsonb) as n`, [JSON.stringify(rows)]);
      expect(again.rows[0].n).toBe(0);

      const inst = await ownerInstrument(s);
      const q = [quoteRow(inst, "101.5", "2031-01-02T16:30:00Z"), quoteRow(inst, "102", "2031-01-03T22:59:59Z")];
      expect((await s.as(a.ownerTrusted, `select public.record_quotes($1::jsonb) as n`, [JSON.stringify(q)])).rows[0].n).toBe(2);
      expect((await s.as(a.ownerTrusted, `select public.record_quotes($1::jsonb) as n`, [JSON.stringify(q)])).rows[0].n).toBe(0);
    });
  });

  it("only automatic sources go through them", async () => {
    await withScenario(async (s) => {
      const a = actors(s.fx);
      const manual = await s.as(a.ownerTrusted, `select public.record_fx_rates($1::jsonb)`, [JSON.stringify([fxRow("EUR", "HUF", "1", "2031-01-02", "manual")])]);
      expect(manual.error).toBe("22023");
      const inst = await ownerInstrument(s);
      const q = await s.as(a.ownerTrusted, `select public.record_quotes($1::jsonb)`, [JSON.stringify([{ ...quoteRow(inst, "1", "2031-01-02T00:00:00Z"), source: "manual" }])]);
      expect(q.error).toBe("22023");
    });
  });

  it("the BÉT is an automatic source too", async () => {
    await withScenario(async (s) => {
      const a = actors(s.fx);
      const inst = await betInstrument(s);
      const q = [{ ...quoteRow(inst, "21.575", "2031-01-02T22:59:59Z"), source: "bet" }];
      const r = await s.as(a.ownerTrusted, `select public.record_quotes($1::jsonb) as n`, [JSON.stringify(q)]);
      expect(r.error, r.message).toBeUndefined();
      expect(r.rows[0].n).toBe(1);
      expect((await s.admin(`select source from public.price_quotes where instrument_id = $1`, [inst])).rows).toEqual([{ source: "bet" }]);
    });
  });

  it("denied actors cannot write, and nobody writes prices for someone else's instrument", async () => {
    await withScenario(async (s) => {
      const a = actors(s.fx);
      const rows = JSON.stringify([fxRow("EUR", "HUF", "364.42", "2031-01-02")]);
      for (const who of DENIED) {
        const r = await s.as(a[who], `select public.record_fx_rates($1::jsonb) as n`, [rows]);
        expect(r.error, who).toBeDefined();
      }
      const strangers = await ownerInstrument(s, s.fx.stranger.userId);
      const r = await s.as(a.ownerTrusted, `select public.record_quotes($1::jsonb)`, [JSON.stringify([quoteRow(strangers, "1", "2031-01-02T00:00:00Z")])]);
      expect(r.error).toBeDefined();
    });
  });
});

describe("coverage", () => {
  it("per FX item (MNB X→HUF, ECB EUR→X) and per instrument (yahoo rows only)", async () => {
    await withScenario(async (s) => {
      const a = actors(s.fx);
      await s.as(a.ownerTrusted, `select public.record_fx_rates($1::jsonb)`, [
        JSON.stringify([
          fxRow("EUR", "HUF", "364", "2031-01-02"), fxRow("EUR", "HUF", "365", "2031-01-06"),
          fxRow("EUR", "USD", "1.1", "2031-01-03", "ECB"),
        ]),
      ]);
      const fx = await s.as(a.ownerTrusted, `select source, currency, first_day::text, last_day::text from public.fx_coverage() where first_day >= '2031-01-01' order by 1, 2`);
      expect(fx.rows.map((r) => [r.source, r.currency, r.first_day, r.last_day])).toEqual([
        ["ECB", "USD", "2031-01-03", "2031-01-03"],
        ["MNB", "EUR", "2031-01-02", "2031-01-06"],
      ]);

      const inst = await ownerInstrument(s);
      await s.as(a.ownerTrusted, `select public.record_quotes($1::jsonb)`, [JSON.stringify([quoteRow(inst, "1", "2031-01-02T22:59:59Z"), quoteRow(inst, "2", "2031-01-05T22:59:59Z")])]);
      await s.as(a.ownerTrusted, `insert into public.price_quotes (instrument_id, price, currency, as_of, source, note) values ($1, 9, 'EUR', '2031-02-01', 'manual', 'kézi')`, [inst]);
      const pc = await s.as(a.ownerTrusted, `select instrument_id, first_day::text, last_day::text from public.price_coverage()`);
      expect(pc.rows).toEqual([{ instrument_id: inst, first_day: "2031-01-02", last_day: "2031-01-05" }]);
      expect((await s.as(a.strangerAal2, `select * from public.price_coverage()`)).rows).toHaveLength(0);
    });
  });

  it("per source: a paper switched from Yahoo to the BÉT has a row for each", async () => {
    await withScenario(async (s) => {
      const a = actors(s.fx);
      const inst = await betInstrument(s);
      await s.as(a.ownerTrusted, `select public.record_quotes($1::jsonb)`, [
        JSON.stringify([
          quoteRow(inst, "20", "2031-02-01T22:59:59Z"),
          { ...quoteRow(inst, "21", "2031-02-10T22:59:59Z"), source: "bet" },
          { ...quoteRow(inst, "22", "2031-02-25T22:59:59Z"), source: "bet" },
        ]),
      ]);
      const pc = await s.as(a.ownerTrusted, `select source, first_day::text, last_day::text from public.price_coverage() where instrument_id = $1 order by 1`, [inst]);
      expect(pc.rows).toEqual([
        { source: "bet", first_day: "2031-02-10", last_day: "2031-02-25" },
        { source: "yahoo", first_day: "2031-02-01", last_day: "2031-02-01" },
      ]);
    });
  });
});

describe("price selection by source (plan §3.3, extended 2026-09-28)", () => {
  it("the window's anchor follows the instrument's source: a later Yahoo row of a BÉT paper is not it", async () => {
    await withScenario(async (s) => {
      const a = actors(s.fx);
      const inst = await betInstrument(s);
      const add = async (price: string, asOf: string, source: string) =>
        (await s.admin(`insert into public.price_quotes (owner_id, instrument_id, price, currency, as_of, source) values ($1, $2, $3, 'EUR', $4, $5) returning id`,
          [s.fx.owner.userId, inst, price, asOf, source])).rows[0].id as string;
      const bet = await add("21", "2031-03-01T22:59:59Z", "bet");
      await add("20", "2031-03-02T22:59:59Z", "yahoo");
      const rows = await s.as(a.ownerTrusted, `select id from public.price_quotes_from('2031-03-03') where instrument_id = $1`, [inst]);
      expect(rows.rows).toEqual([{ id: bet }]);
      const selected = await s.as(a.ownerTrusted, `select id from public.select_price($1, '2031-03-05')`, [inst]);
      expect(selected.rows).toEqual([{ id: bet }]);
    });
  });

  it("price_counts: only the app role may run it, and it works under that role", async () => {
    await withScenario(async (s) => {
      const fn = `'private.price_counts(public.price_quotes,text)'`;
      const acl = await s.admin(
        `select has_function_privilege('authenticated', ${fn}, 'execute') as app,
                has_function_privilege('anon', ${fn}, 'execute') as anon,
                has_function_privilege('service_role', ${fn}, 'execute') as service,
                exists (select 1 from pg_proc p, aclexplode(p.proacl) x where p.oid = ${fn}::regprocedure and x.grantee = 0) as everyone`,
      );
      expect(acl.rows[0]).toEqual({ app: true, anon: false, service: false, everyone: false });

      const a = actors(s.fx);
      const inst = await betInstrument(s);
      const bet = (await s.admin(`insert into public.price_quotes (owner_id, instrument_id, price, currency, as_of, source) values ($1, $2, 21, 'EUR', '2031-03-01T22:59:59Z', 'bet') returning id`,
        [s.fx.owner.userId, inst])).rows[0].id as string;
      const viaSelect = await s.as(a.ownerTrusted, `select id from public.select_price($1, '2031-03-02')`, [inst]);
      expect(viaSelect.error, viaSelect.message).toBeUndefined();
      expect(viaSelect.rows).toEqual([{ id: bet }]);
      const viaWindow = await s.as(a.ownerTrusted, `select id from public.price_quotes_from('2031-03-02') where instrument_id = $1`, [inst]);
      expect(viaWindow.error, viaWindow.message).toBeUndefined();
      expect(viaWindow.rows).toEqual([{ id: bet }]);
      expect((await s.as(a.anon, `select private.price_counts(null::public.price_quotes, 'bet')`)).error).toBe("42501");
    });
  });
});

describe("price_quotes_from – the same choice as selectPrice on the full log", () => {
  it("windowed rows pick the same price as all rows, for every day from the window start", async () => {
    await withScenario(async (s) => {
      const a = actors(s.fx);
      const inst = await ownerInstrument(s);
      const other = await ownerInstrument(s);
      const add = async (instrument: string, price: string, asOf: string, source = "yahoo", extra: { status?: string; supersedes?: string } = {}) => {
        const r = await s.admin(
          `insert into public.price_quotes (owner_id, instrument_id, price, currency, as_of, source, status, supersedes_id, note)
           values ($1, $2, $3, 'EUR', $4, $5, $6, $7, $8) returning id`,
          [s.fx.owner.userId, instrument, price, asOf, source, extra.status ?? "ok", extra.supersedes ?? null, source === "manual" ? "javítás" : null],
        );
        return r.rows[0].id as string;
      };
      await add(inst, "100", "2031-03-01T21:59:59Z");
      const wrong = await add(inst, "999", "2031-03-02T21:59:59Z");
      await add(inst, "101", "2031-03-02T21:59:59Z", "manual", { supersedes: wrong }); // correction, before the window
      await add(inst, "500", "2031-03-03T21:59:59Z", "yahoo", { status: "suspect" });
      await add(inst, "102", "2031-03-05T21:59:59Z");
      const late = await add(inst, "103", "2031-03-06T21:59:59Z");
      await add(inst, "104", "2031-03-06T21:59:59Z", "manual", { supersedes: late }); // correction inside the window
      await add(other, "50", "2031-01-15T21:59:59Z"); // only an anchor
      // A paper switched to the BÉT: before the window its old Yahoo close was corrected twice.
      const bet = await betInstrument(s);
      const betClose = await add(bet, "21", "2031-03-01T21:59:59Z", "bet");
      const oldClose = await add(bet, "20", "2031-03-02T21:59:59Z");
      const fix1 = await add(bet, "20.1", "2031-03-02T21:59:59Z", "manual", { supersedes: oldClose });
      await add(bet, "20.2", "2031-03-02T21:59:59Z", "manual", { supersedes: fix1 });
      await add(bet, "22", "2031-03-05T21:59:59Z", "bet");

      const cols = `id, instrument_id, price::text, currency, as_of, entered_at, source, status, supersedes_id`;
      const toQuote = (r: Record<string, unknown>): PriceQuote => ({
        id: r.id as string, instrumentId: r.instrument_id as string, price: r.price as string, currency: r.currency as string,
        asOf: (r.as_of as Date).toISOString(), enteredAt: (r.entered_at as Date).toISOString(), source: r.source as string,
        status: r.status as PriceQuote["status"], supersedesId: (r.supersedes_id as string | null) ?? null,
      });
      const all = (await s.as(a.ownerTrusted, `select ${cols} from public.price_quotes`)).rows.map(toQuote);
      // Neither the old Yahoo close nor its corrections count for the BÉT paper, in either load.
      expect(selectPrice(all, { id: bet, priceSource: "bet" }, "2031-03-03")?.id).toBe(betClose);
      const anchor = await s.as(a.ownerTrusted, `select id from public.price_quotes_from('2031-03-03') where instrument_id = $1`, [bet]);
      expect(anchor.rows.map((r) => r.id)).toContain(betClose);
      for (const from of ["2031-03-02", "2031-03-04", "2031-03-06", "2031-04-01"]) {
        const windowed = (await s.as(a.ownerTrusted, `select ${cols} from public.price_quotes_from($1::date)`, [from])).rows.map(toQuote);
        expect(windowed.length).toBeLessThanOrEqual(all.length);
        for (const day of [from, "2031-03-03", "2031-03-05", "2031-03-06", "2031-03-07", "2031-04-02"].filter((d) => d >= from)) {
          for (const one of [{ id: inst, priceSource: "yahoo" }, { id: other, priceSource: "yahoo" }, { id: bet, priceSource: "bet" }]) {
            expect(selectPrice(windowed, one, day)?.id ?? null, `${from} ${day} ${one.priceSource}`).toBe(selectPrice(all, one, day)?.id ?? null);
          }
        }
      }
      expect((await s.as(a.strangerAal2, `select * from public.price_quotes_from('2031-01-01')`)).rows).toHaveLength(0);
    });
  });
});
