---
name: drive-expo
description: How to drive an Expo (React Native) app on a simulator or emulator the way a user does and capture proof. Covers Maestro flows, the general health checks, real end states, reading back side effects, and known limits such as no real microphone. Load it before any live check of an Expo app, whether from an app's verification skill or from verify-setup.
---

# Driving an Expo app

## What this guide is

These are the general steps for proving a feature on any Expo app running on a simulator (iOS) or an emulator (Android). The app's own skill, in `.claude/skills/verify-<app>/`, gives the facts: the start command, the app ID, screen labels, test data and what to read back. Read its `facts.json` and the feature file before driving. Follow the proof standard in the `verify` skill throughout.

Below, `<plugin>` means this skill's folder followed by `/../..`, which is the plugin's root folder.

## Record the run

Start an evidence run. It prints the run folder; call it `RUN`.

```sh
RUN=$(node <plugin>/scripts/evidence.mjs start --app <app>)
```

In drive, read-back and unreachable steps, name the feature with `--feature` and a sub-feature ID from the feature file, such as `create-save`. The coverage check counts it toward the feature file that lists it.

Save every screenshot, log and read-back inside `RUN`, and record each step with `evidence.mjs add`. When the run is over:

```sh
node <plugin>/scripts/evidence.mjs finish "$RUN" --status "verified live"
node <plugin>/scripts/evidence.mjs check "$RUN" --full-run --head HEAD
```

## Start

An app that uses native modules needs a development build; Expo Go won't load those modules. The app skill's `start.command` builds and installs it. That is often `expo run:ios`, which also starts Metro, the server that sends the app its JavaScript. When the machine can't build locally, Expo's cloud build service can make a simulator build instead.

Save the output to `"$RUN/start.log"` and the process ID to `"$RUN/metro.pid"`.

## Health check

Save the output as `"$RUN/health.txt"`. All of these must pass:

- **A device is booted:** `xcrun simctl list devices booted` on iOS, or `adb devices` on Android.
- **The installed app has the real app ID:** `xcrun simctl listapps booted | grep -c <appId>`, or `adb shell pm list packages | grep <appId>`.
- **Metro belongs to this checkout.** `http://localhost:8081/status` answers `packager-status:running`. The process on port 8081 has its working folder inside this repository: `lsof -nP -iTCP:8081 -sTCP:LISTEN -t` gives its ID, and `lsof -a -p <id> -d cwd -Fn` gives its folder.
- **The commit is known and the working copy is clean:** `git rev-parse HEAD`, and `git status --porcelain --untracked-files=no` prints nothing.
- **The backend is allowed.** The backend address in the app's environment file is not one of `forbiddenTargets`.
- **The flows are sound:** `node <plugin>/scripts/check-app-skill.mjs .claude/skills/verify-<app>` passes. That means every flow targets the real app ID, acts, and checks its end state.

## Drive with Maestro

Explore with the Maestro tools: `list_devices`, `inspect_screen`, and `run` with inline YAML. For proof, write the flow to `"$RUN/<feature>.yaml"` and run it:

```sh
maestro test --test-output-dir "$RUN/maestro" -e NAME=value "$RUN/<feature>.yaml"
```

The flow's `appId` comes from `facts.json`. Find elements by their visible text or test ID, never by `point:`. A position breaks as soon as the layout, the font size or the device changes.

## Trigger and end state

Every flow has at least one action, which is the trigger. After its last action it waits for the end state with `extendedWaitUntil`, giving `visible:` and a `timeout:`. Take a screenshot with `takeScreenshot` before the trigger and after the end state holds.

```yaml
appId: com.example.app
---
- launchApp
- takeScreenshot: before
- tapOn: "Save"
- extendedWaitUntil:
    visible: "Saved"
    timeout: 10000
- takeScreenshot: after
```

## Permission dialogs

Right after an action that asks for a permission, tap "Allow" with `optional: true`, so the flow works whether or not the dialog appears.

## Read back side effects

Whatever the action changed, check it from a second view, through the backend's own command line tool. Print IDs and counts only, never personal data.

## Clean up

Stop the Metro process this run started, and its children. Shut down a simulator only if this run booted it. Remove test data the run created, using the app skill's commands. Never delete `RUN`. Then run `evidence.mjs check` again to confirm the evidence survived.

## Known limits

- **No real microphone.** An iOS simulator records whatever the Mac's input gives, often silence. Android emulators give silence or a test tone. So for recording features, the live check proves the trigger, the end state, and a read-back of the stored row and file. Component tests prove the sound content itself.
- **No Bluetooth devices.** Use the app's path for "no device" when it has one.
- **No push notifications.** They need a real device.
