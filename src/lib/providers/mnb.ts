/**
 * MNB official exchange rates (SOAP, HTTP only – see docs/spike-report.md).
 * Stored as the MNB publishes them: 1 X = rate HUF. Currencies quoted per
 * 100 units (e.g. JPY) are normalised to 1 unit; raw_unit keeps the original.
 */
import { D, type Day, type Dec } from "@/lib/finance/money";
import { type Budget, fetchText, ProviderError, withRetry, yearChunks } from "./http";

export const MNB_URL = "http://www.mnb.hu/arfolyamok.asmx";

/** One published rate: 1 `base` = `rate` `quote`, on `rateDate`. */
export type SourceRate = { base: string; quote: string; rate: Dec; rawUnit: number; rateDate: Day };

export function mnbRequestBody(start: Day, end: Day, currencies: string[]): string {
  return (
    `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>` +
    `<GetExchangeRates xmlns="http://www.mnb.hu/webservices/"><startDate>${start}</startDate><endDate>${end}</endDate>` +
    `<currencyNames>${currencies.join(",")}</currencyNames></GetExchangeRates></soap:Body></soap:Envelope>`
  );
}

const unescapeXml = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** SOAP response → rates. An empty result (no business day in range) is []. */
export function parseMnbResponse(xml: string): SourceRate[] {
  const result = /<GetExchangeRatesResult>([\s\S]*?)<\/GetExchangeRatesResult>/.exec(xml);
  if (!result) {
    if (/<GetExchangeRatesResult\s*\/>/.test(xml)) return [];
    throw new ProviderError("parse");
  }
  const inner = unescapeXml(result[1]);
  const out: SourceRate[] = [];
  for (const day of inner.matchAll(/<Day date="(\d{4}-\d{2}-\d{2})">([\s\S]*?)<\/Day>/g)) {
    for (const r of day[2].matchAll(/<Rate unit="(\d+)" curr="([A-Z]{3})">([\d.,]+)<\/Rate>/g)) {
      const unit = Number(r[1]);
      const value = new D(r[3].replace(",", "."));
      if (!(unit > 0) || !value.isFinite() || value.lte(0)) throw new ProviderError("parse");
      out.push({ base: r[2], quote: "HUF", rate: value.div(unit), rawUnit: unit, rateDate: day[1] });
    }
  }
  return out;
}

/** All rates for [from, to], one request per calendar year, sequentially. */
export async function fetchMnb(from: Day, to: Day, currencies: string[], budget: Budget, fetchImpl: typeof fetch = fetch): Promise<SourceRate[]> {
  const out: SourceRate[] = [];
  for (const c of yearChunks(from, to)) {
    const xml = await withRetry(
      () =>
        fetchText(
          MNB_URL,
          {
            method: "POST",
            headers: {
              "Content-Type": "text/xml; charset=utf-8",
              SOAPAction: '"http://www.mnb.hu/webservices/MNBArfolyamServiceSoap/GetExchangeRates"',
            },
            body: mnbRequestBody(c.from, c.to, currencies),
          },
          budget,
          fetchImpl,
        ),
      budget,
    );
    out.push(...parseMnbResponse(xml));
  }
  return out;
}
