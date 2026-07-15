// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { Turnstile } from "./Turnstile";

afterEach(() => {
  delete (window as any).turnstile;
  document.getElementById("cf-turnstile-script")?.remove();
});

describe("Turnstile", () => {
  it("renders invisibly for normal humans: interaction-only appearance", async () => {
    const renderSpy = vi.fn();
    (window as any).turnstile = { render: renderSpy };
    // pre-insert the script tag so the component takes the already-loaded path
    const s = document.createElement("script");
    s.id = "cf-turnstile-script";
    document.head.appendChild(s);

    render(<Turnstile siteKey="0xTESTKEY" onToken={() => {}} />);

    await waitFor(() => expect(renderSpy).toHaveBeenCalled());
    const options = renderSpy.mock.calls[0][1];
    expect(options.sitekey).toBe("0xTESTKEY");
    expect(options.appearance).toBe("interaction-only");
  });

  it("renders nothing without a site key", () => {
    const { container } = render(<Turnstile siteKey="" onToken={() => {}} />);
    expect(container.innerHTML).toBe("");
  });
});
