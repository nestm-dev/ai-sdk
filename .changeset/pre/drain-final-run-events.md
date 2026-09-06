---
"@nestm/ai-sdk": patch
---

Drain replay revisions appended while a subscriber is paused yielding an older projection, even when the producer has already finished. This preserves final events for slow HTTP consumers.
