# Morning report prompt template

This is the prompt for the scheduled report run. Fill in everything in `<angle brackets>`.

---

This is <owner>'s combined morning report. They read it at <wake time and zone> on <date>, so it must be finished before then. This run only reports: do not send messages to threads, merge, deploy, restart work or change settings. No quiet hours apply.

Background: at about <time> on <date> the owner left for the night. Their words: "<verbatim>". Each session in the manifest was asked to post a message starting with "MORNING REPORT <date>". The brief they got is at <path to the filled brief>.

Manifest (machine, thread id, one line on the effort):
Briefed:
- <machine> <thread id>: <effort>
Blocked on the owner, not briefed (read the last message only, for the decisions section):
- <machine> <thread id>: <what it is waiting for>

Steps:
1. For each thread, read only its latest messages: read once with a limit of 1 to get `itemCount`, then read from about `itemCount - 12` with a small limit, and page through long messages to get the full MORNING REPORT. Read a coordinator's worker only where the coordinator's report points to it or leaves a gap. If a session has no MORNING REPORT, use its last messages and say plainly that it did not report. Also list top-level threads updated since the brief went out, on every machine, to catch any other session that posted one.
2. Check every claim against the source, never the report alone. For each repository involved (<repositories>): PRs merged since the brief went out, and open PRs that are not drafts, mergeable, with every check passed or skipped and at least one check. For each open PR, find its review evidence on its current head commit. Split them into "reviewed on this head" and "green but not reviewed on this head". Flag every report claim the source contradicts.
3. Progress per effort: start versus now, with how and when it was measured, taken from the reports. Never invent a number; write "not measured" when a session gave none.
4. Build one page for the owner (the owner-page skill if it is installed, otherwise one self-contained HTML file) in <folder>. Sections, in this order:
   a. Summary: merged overnight (count and links), reviewed PRs ready to merge (count), decisions to make (count), decisions to review (count), and any effort that stalled.
   b. PRs to review and merge: reviewed-on-head first, in merge order (a stack's base first), each with link, destination, head, one line on what it does, and its review evidence. Then the green-but-not-reviewed list, briefly.
   c. Decisions to MAKE: one card each, with context, options with a concrete example per option, the session's recommendation, and what happens with no answer. Include what the blocked threads are waiting for.
   d. Decisions to REVIEW: choices sessions made on their own, each with context, choice, why and one example.
   e. Progress per effort: the numbers from step 3 in a small table, plus what was done, with one example each.
   f. Diagrams: every diagram file the sessions made, by absolute path, one line each.
   g. Problems: stalls, rate limits, failed runs, broken CI, machine trouble, and contradictions between reports and the source.
   Write for someone reading cold on a phone. Plain words. Keep secrets and personal or customer data out.
5. Open the page, then reply with a short summary: the counts, the page path, and the three things to do first. Say plainly what the report could not cover.

Give me irrefutable proof that this works.
