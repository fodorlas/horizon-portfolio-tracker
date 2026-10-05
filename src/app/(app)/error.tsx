"use client";

import { useI18n } from "@/components/i18n-provider";
import { buttonClass, Card } from "@/components/ui";

export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { m } = useI18n();
  return (
    <Card>
      <h1 className="text-3xl font-semibold tracking-tight text-accent">{m.errors.pageTitle}</h1>
      <p className="mt-3" role="alert">
        {m.errors.pageText}
      </p>
      <button type="button" onClick={reset} className={`${buttonClass.primary} mt-5`}>
        {m.errors.retry}
      </button>
    </Card>
  );
}
