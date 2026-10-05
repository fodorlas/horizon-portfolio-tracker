import type { ReactNode } from "react";
import { getI18n } from "@/lib/i18n-server";

export async function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  const { m } = await getI18n();
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <section className="w-full max-w-md rounded-3xl border border-border bg-card p-8 shadow-card">
        <p className="font-serif text-2xl text-accent">{m.app.name}</p>
        <h1 className="mt-4 text-xl font-semibold">{title}</h1>
        {children}
      </section>
    </main>
  );
}
