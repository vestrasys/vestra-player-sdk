---
title: How-to guides
---

# How-to guides

How-to guides are short answers to one practical question each: "how do I do X?". They assume you already know the basics from [Getting started](../tutorials/getting-started.md).

The guides are being written. Planned topics include:

- Keep a slider responsive while the user drags it (send only the latest value).
- Show "Starting…" while a callback awaits something slow (`plugin.update()` sends bound properties before the callback returns; see the signal generator, Step 7).
- Remember a window's position and size.
- Build file paths that work on macOS and Windows.
- Run an external program and read its output.
- Test a plugin with the in-memory test host.
- Bundle npm dependencies into a package.

Until a guide exists, the [Examples](../examples/index.md) show most of these techniques in complete plugins.
