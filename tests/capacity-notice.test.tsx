// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { CapacityNotice } from "../src/CapacityNotice";
afterEach(cleanup);
it("announces approaching storage exhaustion without implying completed work frees space", () => {
  const { rerender } = render(
    <CapacityNotice label="Runs" used={399} limit={500} />,
  );
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  rerender(<CapacityNotice label="Runs" used={400} limit={500} />);
  expect(screen.getByRole("status")).toHaveTextContent("nearly full");
  expect(screen.getByRole("status")).toHaveTextContent(
    "Finished work still counts",
  );
  rerender(<CapacityNotice label="Runs" used={500} limit={500} />);
  expect(screen.getByRole("status")).toHaveTextContent("This storage is full.");
});
