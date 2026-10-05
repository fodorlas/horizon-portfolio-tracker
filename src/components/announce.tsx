"use client";
import { useEffect, useState } from "react";

/**
 * One line for screen readers (#27): it says `text` once it has stayed the
 * same for a second, so a total typed key by key is not read out at every
 * key. It is in the page from the start, so its first text is heard too (a
 * live region that appears together with its text is usually not).
 */
export function Announce({ text }: { text: string }) {
  const [said, setSaid] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setSaid(text), 1000);
    return () => clearTimeout(timer);
  }, [text]);
  return (
    <p role="status" className="sr-only">
      {said}
    </p>
  );
}
