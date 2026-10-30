---
name: pr-open
description: Open a pull request and keep it honest until the owner merges. It opens every pull request as a draft, and after each push publishes the proof and runs the ready check, which marks it ready only when it can merge, or asks the owner one question. Use it whenever you open a pull request or push to one, and whenever someone asks whether a pull request is ready.
---

# Opening a pull request

Open every pull request as a draft, with its description in the `plain` layout. After each push, publish the proof with `node <this skill's folder>/../../scripts/evidence.mjs publish --pr <number>` and run `node <this skill's folder>/../../scripts/gate.mjs <number> --apply`. Do what it prints: it marks the pull request ready only when it can merge, and you never merge it yourself.
