# Overnight brief template

Fill in everything in `<angle brackets>`. Delete a "Tonight" line that doesn't apply. Keep the rest as written: each line is there because a night went wrong without it.

---

Owner instruction from <owner>, relayed on <date> at about <time and time zone>: "<the owner's words, verbatim>"

Treat this as authorization to keep working on your existing task until <stop time, local and UTC>. Make ordinary in-scope choices without waiting for <owner>. For each one, write down the evidence, the alternatives, what you chose and why, so you can defend it. Keep approved requirements, repository safety, testing, independent reviews, required reviewer identities and explicit human-only approvals. This does not waive merge, production, guardrail or plan-approval gates. Merge only where your existing authorization and every required gate allow it. Otherwise finish the code, checks and review, and leave an exact merge handoff. No production deploys, production data changes or production config changes tonight. If a human-only decision blocks one item, record it and carry on with independent authorized work. Where <owner> has already answered something in this session, follow that answer. Stay within this session's task and scope. If your work is done, say so in one line; do not invent work.

How to work tonight:
- Unblock what is already open first (CI failures, review findings, rebases, screenshots) before starting new work. <N> green PRs already wait for <owner>'s merge.
- A PR counts as reviewed only when the repository's required reviews passed on its current head commit. Re-check the head before you list it; a review of an older head does not count.
- Hand test, typecheck, lint and search runs to a cheap agent (the `runner` agent). Large models plan, build and review; they do not run test loops themselves.
- Wait only on events: background-task completion, thread waits, PR watches. No `sleep` or polling loops.
- Check a machine's free memory before heavy work. Don't start an emulator or simulator on a machine below its floor; record the blocked proof instead. Shut down any simulator or emulator you started.
- Tonight: <machine headroom, known CI or service outages, and what to do about them>
- If you hit a rate or usage limit, say so in one line and stop. Do not retry in a loop.
- Coordinators: pass this on to active workers that did not receive it directly, collect their evidence, and avoid duplicate builds or reviews.

By <report deadline>, or earlier if your work ends first, post a message in THIS session that starts with the heading "MORNING REPORT <date of the morning>". Write it for someone reading cold on a phone. Include:
1. Progress, with numbers: where this effort stood when it started, where it stands now, and the difference, in the effort's own measure (tasks done of total, score, load time). Say how and when each number was measured, and mark estimates as estimates.
2. What was done tonight, with one concrete example per item (a before and after, a sample input and its result, or a screenshot path).
3. PRs ready for <owner>: link, destination branch, exact head commit, and the review evidence on that head. Then what merged (link, branch, merge commit) and what is open but not ready (link, head, reason).
4. Decisions to REVIEW: choices you made on your own. For each: context, options, what you chose, why, and one concrete example.
5. Decisions to MAKE: what only <owner> can decide. For each: the question, the options with a concrete example of each, and your recommendation.
6. Diagrams: where a flow, state machine or structure changed, draw it (the `plain` skill's diagram tool) and give the file's absolute path. Skip this if nothing structural changed.
7. Proof: exact verification commands and results, plus review links. Save long logs in files and give the paths. Say what the proof does not cover.
8. The shortest exact list of what <owner> must merge, review or decide, in merge order, each with its link.
Keep secrets and personal or customer data out. Do not claim a merge, approval or test you cannot prove. A combined report across all sessions will be built at <report time> from these reports, so you need not send a notification.

For this session tonight: <one line naming this thread's next work>

Give me irrefutable proof that this works.
