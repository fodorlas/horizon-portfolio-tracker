import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { Loaded } from "@/lib/data/load";
import type { Day } from "@/lib/finance/money";
import { syncProposals } from "./sync";

describe("syncProposals", () => {
  it("passes the time its data was read, so a proposal changed since (a send-back meanwhile) is kept (#92)", async () => {
    const rpc = vi.fn(async () => ({ data: 0, error: null }));
    const db = { from: () => ({ select: async () => ({ data: [], error: null }) }), rpc } as never;
    const data = { instrumentMeta: [], events: [], readAt: "2026-10-02T06:00:00.000Z" } as unknown as Loaded;
    await syncProposals(db, data, "2026-10-02" as Day);
    expect(rpc).toHaveBeenCalledWith("sync_pending_events", { p_rows: [], p_read_at: "2026-10-02T06:00:00.000Z" });
  });
});
