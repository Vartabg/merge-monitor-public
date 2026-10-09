// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import axe from "axe-core";
import { TeamDesk } from "../src/TeamDesk";
import { getJson } from "../src/api";
import { assignment } from "./team-fixtures";
vi.mock("../src/api", () => ({ getJson: vi.fn(), postJson: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
it.each(['list','create','detail','review','accepted','empty','error'])("has accessible structure and controls in %s", async (variant) => {
  vi.mocked(getJson).mockResolvedValue({assignments: variant === 'empty' ? [] : [{...assignment,
    status: variant === 'review' ? 'review' : variant === 'accepted' ? 'accepted' : 'queued'}]});
  if (variant === 'error') vi.mocked(getJson).mockRejectedValue(new Error('Offline'));
  const {container} = render(<TeamDesk />);
  const user = userEvent.setup();
  if (variant === 'error') await screen.findByRole('alert');
  else if (variant === 'empty') await screen.findByRole('heading', {name:'Ready for the first assignment.'});
  else {
    await screen.findByRole('button', {name:assignment.title});
    if (variant === 'create') await user.click(screen.getByRole('button', {name:'Add an assignment'}));
    else if (['detail','review','accepted'].includes(variant)) await user.click(screen.getByRole('button', {name:assignment.title}));
    if (variant === 'review') await user.selectOptions(screen.getByLabelText('Recorded progress'), 'accepted');
  }
  expect(screen.getAllByRole('heading', {level:1})).toHaveLength(1);
  expect(screen.getByRole('main')).toHaveAttribute('id', 'main');
  expect(screen.getByRole('link',{name:'Skip to assignments'})).toHaveAttribute('href','#main');
  const result = await axe.run(container, {rules:{'color-contrast':{enabled:false}}});
  expect(result.violations.map((v)=>({id:v.id,nodes:v.nodes.map((n)=>n.target)}))).toEqual([]);
});
