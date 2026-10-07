# The fields in `facts.json`

`facts.json` holds the facts an agent drives an app by. `check-app-skill.mjs` checks it. Examples come from `example/verify-notes/facts.json`.

## Required for every app

| Field | Type | Example | Where to find the real value |
|---|---|---|---|
| `app` | text | `"notes"` | The skill's folder name without `verify-`. It must match the folder. |
| `surface` | `"web"` or `"expo"` | `"web"` | Next.js, Vite and similar apps are `web`. An `app.json` with an `expo` key means `expo`. |
| `appRoot` | text, a folder path from the repository root | `"apps/notes"` | The folder holding the app's `package.json`. It must exist. |
| `start.command` | text, a shell command | `"cd apps/notes && npm run dev -- --port 4173"` | The app's documented dev script in `package.json` or its readme. |
| `start.ready` | text, a shell command that succeeds once the app is ready | `"curl -sf -o /dev/null http://127.0.0.1:4173/"` | The port from the dev script, or a log line the start command prints. |
| `start.stop` | text, a shell command | `"pkill -TERM -P \"$(cat \"$RUN/server.pid\")\"; kill \"$(cat \"$RUN/server.pid\")\""` | Stop the process this run started, by the ID saved in the run folder. Never stop a process by name. |

## Required for a web app

| Field | Type | Example | Where to find the real value |
|---|---|---|---|
| `web.baseUrl` | text, an `http://` or `https://` address | `"http://127.0.0.1:4173"` | The port in the dev script or the framework's settings file. |

## Required for an Expo app

| Field | Type | Example | Where to find the real value |
|---|---|---|---|
| `expo.appId` | text | `"com.example.notes"` | `ios.bundleIdentifier` and `android.package` in `app.json`. Both must agree with it. |
| `expo.appConfig` | text, a file path | `"apps/notes-mobile/app.json"` | The app's `app.json`. It must exist. |
| `expo.flows` | text, a folder path (optional) | `"apps/notes-mobile/maestro"` | The folder of Maestro flows. Every flow in it is checked against `expo.appId`. |

## Optional

| Field | Type | Example | Where to find the real value |
|---|---|---|---|
| `web.envFile` or `expo.envFile` | text, a file path | `"apps/notes/.env.local"` | The environment file the app reads at start. The health check searches it for `forbiddenTargets`. |
| `replays` | list of file paths | `["e2e/notes/create.spec.ts"]` | Existing Playwright tests or Maestro flows the skill relies on. Each must exist, and each is checked for fixed pauses and screen positions. |
| `forbiddenTargets` | list of text | `["notes.example.com"]` | Production deployments and addresses. Confirm them with the owner. The health check stops the run if the app points at one. |
| `testData` | object of named fixtures | `{ "seed": "NOTES_DATA_DIR=\"$RUN/data\" npm run seed --prefix apps/notes" }` | Seed scripts, test accounts and fixture files. For each one, give the command that creates or resets it. |
| `readBack` | object of named commands | `{ "note": "sqlite3 \"$RUN/data/notes.db\" \"select id, length(body) from notes where title = '<title>'\"" }` | The backend's own command line tool. Each command reads stored data and prints IDs and counts only, never personal data. |

`RUN` in these commands is the evidence run folder that `evidence.mjs start` prints.
