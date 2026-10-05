import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Announce } from "./announce";

describe("Announce: one status line that speaks when the text settles (#27)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("says the text after it stayed the same for a second, not every change on the way", () => {
    const { rerender } = render(<Announce text="" />);
    const line = screen.getByRole("status");
    expect(line).toHaveClass("sr-only");
    rerender(<Announce text="1 ×" />);
    act(() => void vi.advanceTimersByTime(600));
    rerender(<Announce text="12 ×" />);
    act(() => void vi.advanceTimersByTime(600));
    expect(line).toHaveTextContent("");
    act(() => void vi.advanceTimersByTime(400));
    expect(line).toHaveTextContent("12 ×");
  });

  it("the first text is spoken too: the line is there before it", () => {
    render(<Announce text="Elérhető: 500 EUR." />);
    expect(screen.getByRole("status")).toHaveTextContent("");
    act(() => void vi.advanceTimersByTime(1000));
    expect(screen.getByRole("status")).toHaveTextContent("Elérhető: 500 EUR.");
  });
});
