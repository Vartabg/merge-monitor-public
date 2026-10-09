import type { Repo } from "./types";

export function AgentAccess({ repo }: { repo: Repo }) {
  const argument = "'" + repo.id.replaceAll("'", "'\"'\"'") + "'";
  return (
    <details className="simple-help agent-access">
      <summary>Direct access for AI tools</summary>
      <p>
        An AI coding tool with terminal access to this Mac can read the report
        directly. You do not need to copy each finding into a chat.
      </p>
      <p>
        Set it up once: ask your coding tool to run this from the Merge Monitor
        folder before combining its work. Add <code>--branch</code> followed by
        its branch name to check just that work.
      </p>
      <pre>
        <code>{`npm run --silent agent:check -- --repo ${argument}`}</code>
      </pre>
      <p>
        The command returns current findings and the work they affect. If a
        check is unavailable or out of date, it says so. Your coding tool must
        still review, test, and recheck the code before making changes.
      </p>
      <p className="helper">
        This provides access to a report. It does not connect to AI chats, send
        messages, or start repairs automatically.
      </p>
    </details>
  );
}
