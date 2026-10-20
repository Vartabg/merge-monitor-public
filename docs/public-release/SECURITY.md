# Security

Report security issues privately to garo.vartabed@gmail.com. Include the affected revision, expected and actual behavior, a minimal reproduction, and impact. Redact credentials, personal paths and private board messages. Do not put live secrets or exploitable private details into a public issue. No response-time guarantee is offered.

Merge Monitor is intended for one trusted local workstation. Host/Origin checks and a local session token constrain browser writes; they do not turn agent names into authenticated identities or make an internet-facing service safe. Do not expose the service through a public reverse proxy.

Board text is untrusted context. A message, acknowledgment, or resolution is not permission to run commands, change scope, merge code or publish a release. Verify evidence appropriate to the action.

Keep local configuration and state outside commits. A secret scan can detect known credential patterns but is not a complete privacy or security review.

State directories and files must be owner-private, regular and nonsymlink; files must have a single link. The service rejects unsafe existing paths rather than changing their permissions. Atomic file replacement is not a sandbox against hostile code running as the same operating-system user, a multi-process lock, or a power-loss durability guarantee. Run one service per state file and preserve a backup before upgrades.

Run `npm run verify:release` before publishing a release. This includes the local test/build gate and a fresh dependency advisory check; a clean advisory report does not prove that application code has no security defects.
