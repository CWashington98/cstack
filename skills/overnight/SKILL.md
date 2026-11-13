---
name: overnight
description: Keep the owner's agent sessions working while they sleep, then have one combined morning report ready when they wake. Use when the owner says they are going to bed or away and the sessions should keep going ("I'm going to sleep", "on your own until 8am", "keep working without me", "same deal as usual"), or asks for a morning report of overnight work.
---

# overnight

The owner is leaving for the night. Every session that has real work left gets one brief that lets it keep going on its own, and a scheduled run builds one report from all of them before the owner wakes.

Three steps, in order: pick the sessions, send the brief, schedule the report. Then tell the owner what you did.

## 1. Pick the sessions

List the top-level threads on every machine the owner works on. In T3: `t3_environment_links` for the machines, then `t3_thread_list` on each (`includeSubagents: false`, `allProjects: true`), keeping threads updated in the last 72 hours that are not settled.

For each one, read only its last few messages (`t3_thread_read` with `afterPosition` near `itemCount`; a read without it returns the oldest items). Sort each thread into one group:

| Group | Looks like | What to do |
|---|---|---|
| **Has work** | Running; or its last message names a next step it can take itself | Send the brief, with a focus line |
| **Coordinator** | It started other threads (chains, workers) and collects their results | Send the brief, and tell it which of its workers you briefed directly |
| **Blocked on the owner** | Its only next step is the owner's merge, approval or decision | Don't send. List it in the report's manifest so its question reaches the owner |
| **Done** | A final report or a one-off answer with nothing left | Don't send |

Don't wake a done or blocked thread to have it say "nothing to do". Each wake reloads its whole context, which costs real tokens.

Skip your own thread, and skip digest or report threads made by scheduled tasks.

## 2. Send the brief

Copy [relay-template.md](relay-template.md), fill in the date, the owner's own words, the stop time and the report heading, and add tonight's facts: machine headroom, known CI outages, rate limits. Save the filled copy in your scratch folder, because the morning report links to it.

Send it to each picked thread with `t3_thread_send` (`mode: "auto"`, plus `environmentId` for other machines). Send the full text, not a file path: another machine can't read your files. End each copy with one line naming that thread's next work, taken from its own last message. For example: "For this session tonight: build the seven unblocked slices you listed (P28 to P36)."

A send to a running thread steers its current turn; a busy one may be queued. Both are fine. Note any send that fails.

## 3. Schedule the report

Create one `schedule_task`:

- `schedule: {type: "once", runAt: <about 40 minutes before the owner wakes>}`.
- `bindToCurrentThread: false`. A run bound to a busy thread waits behind that thread's queue and can be cancelled before it starts. Each unbound run gets a new thread of its own.
- The prompt: fill [report-template.md](report-template.md) with the manifest, meaning every briefed thread plus every blocked-on-owner thread, each with its machine and id.

Report the returned `nextRunAt` to the owner. Next morning, before claiming the report ran, check the run's start time with `list_scheduled_tasks`. A task that was scheduled but never started is a failed report.

## 4. Tell the owner

Keep it short. Include:

- How many threads you briefed, linked with each tool's `link` value, and the one-line focus each got.
- Which threads you left alone and why (blocked on them, or done).
- When the report runs, and where its page will be.
- Anything that will limit the night: a full machine, broken CI, a usage limit.

## Rules

- The brief authorizes in-scope work only. Merge, production, guardrail and plan-approval gates stay closed unless the owner already opened them for that session.
- Never send the brief to threads in a project or repository the owner didn't mean. If you can't tell, leave the thread out and say so.
- If the owner's words name things for the morning ("I want to review the PRs our AI review passed"), put them word for word in the brief and in the report prompt.
