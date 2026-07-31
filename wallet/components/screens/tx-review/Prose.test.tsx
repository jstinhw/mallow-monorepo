import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Prose } from "./Prose";

describe("Prose", () => {
  it("renders **bold** as <strong> and `code` as <code>", () => {
    render(<Prose text="The call is `transfer(address,uint256)` per **Findings**." />);
    expect(screen.getByText("Findings").tagName).toBe("STRONG");
    expect(screen.getByText("transfer(address,uint256)").tagName).toBe("CODE");
  });

  it("renders '-' lines as a bullet list", () => {
    render(<Prose text={"Summary line.\n\n- first impact\n- second impact"} />);
    const items = screen.getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual(["first impact", "second impact"]);
  });

  it("separates blank-line blocks into distinct paragraphs", () => {
    const { container } = render(<Prose text={"Para one.\n\nPara two."} />);
    expect(container.querySelectorAll("p").length).toBe(2);
  });

  it("does not leak raw markdown markers into the output", () => {
    const { container } = render(<Prose text="Sends **10 USDC** to `0xabc`." />);
    expect(container.textContent).not.toContain("**");
    expect(container.textContent).not.toContain("`");
  });
});
