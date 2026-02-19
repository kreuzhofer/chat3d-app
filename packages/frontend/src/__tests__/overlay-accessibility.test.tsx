// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Dialog } from "../components/ui/dialog";
import { Drawer } from "../components/ui/drawer";

describe("overlay accessibility behavior", () => {
  it("closes dialog on Escape and traps keyboard focus", () => {
    const onClose = vi.fn();

    render(
      <Dialog open title="Confirm" onClose={onClose}>
        <button type="button">Primary</button>
        <button type="button">Secondary</button>
      </Dialog>,
    );

    const primary = screen.getByRole("button", { name: "Primary" });
    const secondary = screen.getByRole("button", { name: "Secondary" });

    expect(document.activeElement).toBe(primary);

    secondary.focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(document.activeElement).toBe(primary);

    primary.focus();
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(secondary);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("closes drawer on Escape and keeps focus inside", () => {
    const onClose = vi.fn();

    render(
      <Drawer open title="Navigation" onClose={onClose}>
        <button type="button">A</button>
        <button type="button">B</button>
      </Drawer>,
    );

    const buttonA = screen.getByRole("button", { name: "A" });
    const buttonB = screen.getByRole("button", { name: "B" });

    expect(document.activeElement).toBe(buttonA);

    buttonB.focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(document.activeElement).toBe(buttonA);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
