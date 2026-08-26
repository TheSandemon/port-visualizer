# Contributing

Contributions should stay focused on Windows port inspection, monitoring, and process management. Open an issue before proposing a new feature or architectural change.

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

## Pull requests

- Keep each pull request limited to one problem.
- Add or update tests for behavior changes.
- Preserve the sandboxed renderer and context-isolated IPC boundary.
- Do not add dependencies unless the change clearly requires one.
- Update user-facing documentation when commands or behavior change.
- Include a clear summary, verification results, and screenshots for visible UI changes.
