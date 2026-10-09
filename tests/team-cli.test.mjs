import { expect, it, vi } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTeamQueue } from "../scripts/team-queue.mjs";

it("rejects remote origins and invalid commands before requesting credentials", async () => {
  const fetcher = vi.fn();
  for (const args of [ ['run'], ['list', '--input', 'file.json'], ['create'],
    ['list', '--origin', 'https://example.com'], ['list', '--origin', 'http://localhost@evil.invalid'],
    ['list', '--origin', 'http://localhost:5173/other'], ['list', '--origin', 'http://127.0.0.1:5173?x=1'] ])
    await expect(runTeamQueue(args, fetcher)).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});
it("passes JSON to the authenticated local endpoint without exposing the token", async () => {
  const root = await mkdtemp(join(tmpdir(), 'queue-cli-'));
  try {
    const path = join(root, 'input.json');
    await writeFile(path, JSON.stringify({ title: 'A repair' }));
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({token:'test-session-token'})))
      .mockResolvedValueOnce(new Response(JSON.stringify({title:'A repair', revision:1})));
    expect(await runTeamQueue(['create', '--input', path], fetcher)).toEqual({title:'A repair', revision:1});
    expect(fetcher.mock.calls[1][1]).toMatchObject({ redirect: 'error', method: 'POST', headers: {
      Origin: 'http://127.0.0.1:5173', 'X-Merge-Monitor-Token':'test-session-token',
    }, body: JSON.stringify({title:'A repair'}) });
  } finally { await rm(root, {recursive:true, force:true}); }
});
