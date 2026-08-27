# Contributing

Contributions should stay focused on Windows port inspection, monitoring, and process management.
Open an issue before proposing a new feature or architectural change.

## Setup

Requires Windows, Node.js 20 or newer, and npm.

```powershell
git clone https://github.com/TheSandemon/port-visualizer.git
cd port-visualizer
npm ci
npm run dev
```

## Verification

Run the same checks used by CI before opening a pull request:

```powershell
npm run lint
npm run typecheck
npm test
npm run build
```

Use `npm run dist` only when you need to verify the Windows installer and portable package.

## Architecture boundaries

Keep operating-system observations separate from inferred knowledge. Scanner facts belong on
`PortEntry`; interpretations belong in source-attributed `annotations`; rolling measurements
belong in `telemetry`.

- Add service knowledge without TypeScript changes through a knowledge pack and fixtures.
- Improve Windows collection in `src/main/scanner.ts` or behind its collector boundary.
- Add telemetry as versioned `PortEvent` data covered by pure Vitest tests.
- Preserve keyboard focus, reduced motion, and the distinction between facts and inferred badges.
- Give external I/O and subprocess work descriptive error handling and bounded timeouts.

## Pull requests

- Keep each pull request limited to one problem.
- Add or update tests for behavior changes and malformed external input.
- Preserve the sandboxed renderer and context-isolated IPC boundary.
- Do not add dependencies unless the change clearly requires one.
- Avoid unrelated formatting or refactoring.
- Update user-facing documentation when commands or behavior change.
- Include a clear summary, verification results, and screenshots for visible UI changes.

## Versioning

Port Visualizer uses Semantic Versioning and remains in the `0.x` development series. Feature
releases increment the minor version (`0.3.0` to `0.4.0`); compatible fixes increment the patch
version (`0.3.0` to `0.3.1`). Package metadata omits the `v` prefix; Git tags, release names, and
release pull requests use it (`v0.3.0`). Do not advance to `1.0.0` without an explicit stability
decision documented in the repository.
