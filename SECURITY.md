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
