# Security policy

## Supported versions

`@nestm/ai-sdk` is prerelease software. Security fixes are provided on the latest published alpha only.

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub Security Advisories for
[`nestm-dev/ai-sdk`](https://github.com/nestm-dev/ai-sdk/security/advisories/new). Do not open a public
issue for a suspected vulnerability.

Include affected versions, a minimal reproduction, impact, and any suggested mitigation. Maintainers will
acknowledge the report as soon as practical and coordinate disclosure after a fix is available.

## Security boundaries

This package does not store API keys or mediate provider credentials. Applications remain responsible for:

- keeping provider credentials server-side and outside source control;
- validating user-controlled prompts, files, tool inputs, and tool outputs;
- authorizing tool execution and treating model-requested approval as untrusted input;
- applying rate limits, output controls, and provider-specific data-retention policies;
- reviewing AI SDK telemetry options before sending sensitive prompt or response data.

## Harness security boundary

Harness adapters can place bridge credentials inside unfinished `continueFrom` state. The durable
runner therefore persists only completed resume state. It destroys the session and deletes the
checkpoint on errors, timeouts, disconnects, or unfinished completion, and rejects any durable
policy containing `detach`. Ephemeral continuation is an explicit opt-in and must never be copied to
a durable database, log, trace, or queue payload.

After the durable `running` marker is committed, session-start and checkpoint-commit failures fail
closed as `recovery-required`, or retain the stale `running` marker if the store cannot accept that
transition. Either state rejects a silent new prompt. If `stop()` violates its completed-turn
invariant by returning `continueFrom`, the runner uses that in-memory state to resume and destroy the
exact session before deleting state. Cleanup is deadline-bound and releases the fenced lease last.
Recovery markers contain fixed metadata codes, not native error messages that could disclose URLs,
tokens, prompts, or provider output.

Harness network ingress should be treated as public unless the sandbox provider proves
authentication. Keep egress policy authoritative in the sandbox provider, pass only restricted
sandbox views to host tools, and never persist signed endpoint URLs or tokens. Claude Code's native
approval/filtering remains available. The tested Codex adapter requires
`permissionMode: "allow-all"` for built-ins; enabling it is an explicit risk that requires sandbox
isolation, least-privilege credentials, and restrictive egress.

The Harness compatibility guard deliberately pins the supported AI SDK/Harness patches. Upgrade the
entire candidate train together and re-audit serialized lifecycle state for secrets before accepting
a newer train. Workflow Harness persistence is not exposed under the current security policy.
