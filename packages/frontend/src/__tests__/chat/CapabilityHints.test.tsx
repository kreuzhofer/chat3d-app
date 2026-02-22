// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { CapabilityHints } from "../../components/chat/CapabilityHints";

describe("CapabilityHints", () => {
  afterEach(cleanup);

  it("renders the trigger button with correct label", () => {
    render(createElement(CapabilityHints));
    const trigger = screen.getByRole("button", { name: "What can I build?" });
    expect(trigger).toBeDefined();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.getAttribute("aria-haspopup")).toBe("true");
  });

  it("opens the popover panel when trigger is clicked", () => {
    render(createElement(CapabilityHints));
    const trigger = screen.getByRole("button", { name: "What can I build?" });

    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "Capability hints" });
    expect(dialog).toBeDefined();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });

  it("displays supported part types in the popover", () => {
    render(createElement(CapabilityHints));
    fireEvent.click(screen.getByRole("button", { name: "What can I build?" }));

    const dialog = screen.getByRole("dialog", { name: "Capability hints" });
    expect(dialog.textContent).toContain("Gears");
    expect(dialog.textContent).toContain("Brackets & Mounts");
    expect(dialog.textContent).toContain("Enclosures");
    expect(dialog.textContent).toContain("Adapters & Fittings");
    expect(dialog.textContent).toContain("Mechanical Components");
  });

  it("displays example dimensions in the popover", () => {
    render(createElement(CapabilityHints));
    fireEvent.click(screen.getByRole("button", { name: "What can I build?" }));

    const dialog = screen.getByRole("dialog", { name: "Capability hints" });
    expect(dialog.textContent).toContain("Module 1–5mm");
    expect(dialog.textContent).toContain("Up to 200mm spans");
    expect(dialog.textContent).toContain("6–50mm diameters");
  });

  it("displays known limitations in the popover", () => {
    render(createElement(CapabilityHints));
    fireEvent.click(screen.getByRole("button", { name: "What can I build?" }));

    const dialog = screen.getByRole("dialog", { name: "Capability hints" });
    expect(dialog.textContent).toContain("Known limitations");
    expect(dialog.textContent).toContain("Complex organic shapes");
    expect(dialog.textContent).toContain("Thread generation");
    expect(dialog.textContent).toContain("Assemblies with multiple moving parts");
  });

  it("closes the popover when close button is clicked", () => {
    render(createElement(CapabilityHints));
    fireEvent.click(screen.getByRole("button", { name: "What can I build?" }));

    expect(screen.getByRole("dialog", { name: "Capability hints" })).toBeDefined();

    const closeBtn = screen.getByRole("button", { name: "Close capability hints" });
    fireEvent.click(closeBtn);

    expect(screen.queryByRole("dialog", { name: "Capability hints" })).toBeNull();
  });

  it("closes the popover when Escape key is pressed", () => {
    render(createElement(CapabilityHints));
    fireEvent.click(screen.getByRole("button", { name: "What can I build?" }));

    expect(screen.getByRole("dialog", { name: "Capability hints" })).toBeDefined();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: "Capability hints" })).toBeNull();
  });

  it("closes the popover when clicking outside", () => {
    render(createElement(CapabilityHints));
    fireEvent.click(screen.getByRole("button", { name: "What can I build?" }));

    expect(screen.getByRole("dialog", { name: "Capability hints" })).toBeDefined();

    fireEvent.mouseDown(document.body);

    expect(screen.queryByRole("dialog", { name: "Capability hints" })).toBeNull();
  });

  it("toggles the popover on repeated trigger clicks", () => {
    render(createElement(CapabilityHints));
    const trigger = screen.getByRole("button", { name: "What can I build?" });

    // Open
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "Capability hints" })).toBeDefined();

    // Close
    fireEvent.click(trigger);
    expect(screen.queryByRole("dialog", { name: "Capability hints" })).toBeNull();
  });

  it("does not render the popover panel initially", () => {
    render(createElement(CapabilityHints));
    expect(screen.queryByRole("dialog", { name: "Capability hints" })).toBeNull();
  });
});
