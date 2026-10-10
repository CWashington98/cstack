---
name: drive-web
description: How to drive a web app the way a user does and capture proof. Covers Playwright for recorded checks, browser tools for exploring, the general health checks, waiting for real end states, reading back side effects, and stopping only what you started. Load it before any live check of a web app, whether from an app's verification skill or from verify-setup.
---

# Driving a web app

## What this guide is

These are the general steps for proving a feature on any running web app. The app's own skill, in `.claude/skills/verify-<app>/`, gives the facts: the start command, the address, routes, labels, the test identity and what to read back. Read its `facts.json` and the feature file before driving. Follow the proof standard in the `verify` skill throughout.

Below, `<plugin>` means this skill's folder followed by `/../..`, which is the plugin's root folder.

## Record the run

Start an evidence run. It prints the run folder; call it `RUN`.

```sh
RUN=$(node <plugin>/scripts/evidence.mjs start --app <app>)
```

In drive, read-back and unreachable steps, name the feature with `--feature` and a sub-feature ID from the feature file, such as `create-save`. The coverage check counts it toward the feature file that lists it. If two feature files list the same ID, write the file name first, such as `notes/save`; a shared ID on its own counts for neither.

Save every screenshot, log and read-back inside `RUN`. Record each step as you go with `evidence.mjs add`, for example:

```sh
node <plugin>/scripts/evidence.mjs add "$RUN" --kind health --artifact health.txt --ok
```

When the run is over, finish it and check it:

```sh
node <plugin>/scripts/evidence.mjs finish "$RUN" --status "verified live"
node <plugin>/scripts/evidence.mjs check "$RUN" --full-run --head HEAD
```

The script refuses "verified live" when a rule of the proof standard is broken, so a wrong status can't slip through.

## Start

Run the app skill's `start.command` in the background, with its output going to `"$RUN/server.log"`. Write its process ID to `"$RUN/server.pid"`. Then wait for `start.ready` to succeed: run it in a loop of short checks with an overall time limit, never as one long pause.

## Health check

Run it before the first drive, and again after anything surprising. Save the output as `"$RUN/health.txt"`. All of these must pass:

- **The address answers:** `curl -sf <baseUrl>`.
- **The server belongs to this checkout.** `lsof -nP -iTCP:<port> -sTCP:LISTEN -t` gives the process ID of whatever listens on the port. `lsof -a -p <id> -d cwd -Fn` shows that process's working folder, which must be inside this repository. Another checkout's server on the same port is the most common cause of evidence from a stale build.
- **The commit is known and the working copy is clean:** `git rev-parse HEAD`, and `git status --porcelain --untracked-files=no` prints nothing.
- **The backend is allowed.** Read the environment file the app skill names, and search it for each name in `forbiddenTargets`. Any match stops the run.
- **The test identity is signed in:** a page that needs sign-in loads without being sent to the sign-in page.

## Choose the driver

There are four ways to drive a browser. Pick by what the step needs:

| Driver | Use it for | What it can capture | Watch out for |
|---|---|---|---|
| **Playwright, headless** (Chromium with no window) | Proof. The steps are a script, so they're saved and can be run again, and later become a replay. | Screenshots of the page, the full page or one element; video of the whole run; a trace of every step | Sign-in providers that block automated browsers; autoplay needs the flag below |
| **Playwright, with a window** (`headless: false`) | Watching a script run while you fix it | The same | Slower; not for unattended runs |
| **Chrome DevTools** (the `chrome-devtools` tools) | Exploring a page you don't know yet: the console, network requests, performance traces and an accessibility audit | Screenshots, console and network logs, performance traces | A separate browser profile, not your everyday Chrome, but it stays signed in between sessions. Check who is signed in before acting, and sign in as the test identity. Start its server with `--isolated` for a clean profile each time. |
| **Claude in Chrome** (the `claude-in-chrome` tools) | Pages that need a real browser: a sign-in provider that blocks automation, or what the test identity sees in a real signed-in session | Screenshots and an animated recording of the steps | It is the owner's real Chrome, with real accounts. Only use the test identity and the backends the app skill allows. Never trigger alert, confirm or prompt dialogs, which freeze the tools. |

Explore with Chrome DevTools or Claude in Chrome, then write the proof as a Playwright script at `"$RUN/drive.mjs"` and run it with the project's own Playwright install. A finding from exploring is only a lead: the proof is the script's run. Launch Chromium with `--autoplay-policy=no-user-gesture-required` when the feature plays audio or video.

A starting point for `drive.mjs`:

```js
// Written fresh for each run. Run with the project's Playwright: RUN=... BASE_URL=... node drive.mjs
// Projects install either playwright or @playwright/test; this loads whichever is there.
const { chromium } = await import("playwright").catch(() => import("@playwright/test"));
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

const { RUN, BASE_URL, STORAGE_STATE, CAPTURE } = process.env;
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const context = await browser.newContext({
  ...(STORAGE_STATE ? { storageState: STORAGE_STATE } : {}),
  recordVideo: { dir: RUN }, // one .webm per page (a second tab gets its own), saved when the context closes
});
await context.tracing.start({ screenshots: true, snapshots: true });
const page = await context.newPage();
let n = 0;
page.on("response", async (r) => {
  if (!CAPTURE || !r.url().includes(CAPTURE)) return;
  const body = await r.body().catch(() => null);
  if (body) await writeFile(join(RUN, `body-${++n}.bin`), body);
});
try {
  await page.goto(BASE_URL);
  // Steps from the feature file go here: screenshot, act, wait for the end state, screenshot.
} finally {
  await context.tracing.stop({ path: join(RUN, "trace.zip") }); // open with: npx playwright show-trace trace.zip
  await context.close();
  await browser.close();
}
```

## Drive with stable handles

Find elements by route, by role with its accessible name (`getByRole("button", { name: "Play" })`), by label, or by `data-*` attributes taken from the code. Never use screen positions or tab order; they break when the layout changes. Pair each action with the result you expect to see.

## Wait for the real end state

Never use `waitForTimeout`. Wait for an element to appear or disappear, for a response (`page.waitForResponse`), for a URL, or for a counter with `expect.poll`. Give each wait a time limit. A wait that runs out is a failed step, not a reason to retry.

## Capture the trigger and the end state

Take one screenshot just before the action and another once the end state holds: `"$RUN/<feature>-before.png"` and `"$RUN/<feature>-after.png"`. Headless Chromium takes screenshots the same way a visible one does:

```js
await page.screenshot({ path: join(RUN, "save-before.png") });                 // what's on screen
await page.screenshot({ path: join(RUN, "save-after.png"), fullPage: true });  // the whole page, scrolled
await page.getByRole("dialog").screenshot({ path: join(RUN, "save-dialog.png") }); // one element
```

The video and trace from the starting point above cover the steps between screenshots. The trace shows every action with a picture of the page before and after it. For pages that are mostly text, also save `page.locator("body").ariaSnapshot()` to a `.txt` file.

## Read back side effects

Whatever the action changed, check it from a second view: the row through the backend's own command line tool, the file through its download path, the message through its outbox.

For files the app serves, save the response bodies into `RUN` (the `CAPTURE` setting in the starting point above does this). Or compute a sha256 fingerprint in the page with `crypto.subtle.digest`. Then compare them with the stored source files:

```sh
node <plugin>/scripts/match-bytes.mjs --source <stored files> --body "$RUN"/body-*.bin
```

Bytes that match prove the feature. "The response was 200" does not.

## Clean up

Stop the process in `server.pid` and its children (`pkill -TERM -P <id>; kill <id>`), then confirm the port is free. Never stop a process by name, and never stop a server this run didn't start. Remove test data the run created, using the app skill's clean-up commands. Never delete `RUN`. Then run `evidence.mjs check` again to confirm the evidence survived.

## Known limits

- Sign-in providers block automated browsers, unless the app skill's test identity uses the provider's testing mode.
- Headless Chromium blocks autoplay without the flag above.
- Downloads need `page.waitForEvent("download")`.
- A page that draws a placeholder when its data fails to load can look right while being wrong. Always read back.
