# @nestm/ai-sdk

## 0.1.0-alpha.5

### Patch Changes

- 0b2e4f9: Declare stable NestJS 12 peer support and refresh the validated AI SDK Harness dependency train.

## 0.1.0-alpha.4

### Minor Changes

- ec6ce7f: Add optional, content-free AI observability through lazy `./observability`,
  `./observability/core`, `./observability/http`, and `./observability/testing` entrypoints, including
  bounded aggregation, explicit AI SDK telemetry registration, a snapshot projection, deterministic
  testing utilities, and private end-to-end dashboard and multi-provider playground workspaces.

## 0.1.0-alpha.3

### Minor Changes

- bfa1e20: Add validated AI SDK 7 request defaults for retries and deadlines, compose timeout and caller abort
  signals across supported modalities, propagate Express/Fastify disconnects into agent execution,
  harden HTTP stream cleanup around backpressure races, and preserve exact agent metadata/tool message
  types across the HTTP response helpers.

## 0.1.0-alpha.2

### Minor Changes

- ae7fbcd: Add experimental `./harness` and `./harness/testing` entrypoints with fenced session leases,
  CAS-protected checkpoints, durable credential-safe finalization, explicit continuation, UI response
  bridging, and exact AI SDK Harness release-train validation.

## 0.1.0-alpha.1

### Minor Changes

- b705d17: Add the initial provider-neutral AI SDK 7 integration for NestJS 12 with typed model access,
  toolsets, named agents, HTTP response bridges, and full-modality testing helpers.

## 0.1.0-alpha.0

### Minor Changes

- Bootstrap the prerelease package for the NestJS 12 and AI SDK 7 integration.
