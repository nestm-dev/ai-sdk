---
"@nestm/ai-sdk": patch
---

Start model idle deadlines only after substantive output. Reasoning, text, and tool-input block headers and empty deltas no longer trigger the shorter idle timeout while the provider is still preparing its first output. First-output and total deadlines remain active.
