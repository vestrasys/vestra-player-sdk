---
title: Give a coding agent the documentation
description: Let Claude Code, Cursor or your own agent read this documentation by path, like go doc, with vestra-plugin docs or @vestra-player/sdk/docs, a few kilobytes at a time.
---

# Give a coding agent the documentation

**Goal:** a coding agent writing a plugin reads exactly the part of this documentation it needs: the signature and errors of one method, one guide, the members of one interface.

The documentation is a tree of short nodes with the same pages and API as this site. `/` lists the top level; every node shows its text and then the paths one level down, each with a one-line summary, so an agent walks down from `/` or searches. Every answer is at most 8 KB; a longer one comes in pages. There is no single file with everything: an agent that loads a megabyte of reference reads none of it well.

## Steps

### Point the agent at the command line

In a project that depends on `@vestra-player/sdk`, any agent that can run commands reads the tree with `npx vestra-plugin docs`. Elsewhere (no `package.json` with the SDK yet), name the package: `npx -p @vestra-player/sdk vestra-plugin docs`. Put this in the agent's instructions (`CLAUDE.md`, `AGENTS.md`, a Cursor rule):

```text
The Vestra Player SDK documentation is a tree read by path:
  npx -p @vestra-player/sdk vestra-plugin docs /                    the top level
  npx -p @vestra-player/sdk vestra-plugin docs Snapshot             a declaration and its members
  npx -p @vestra-player/sdk vestra-plugin docs Snapshot.export      one member
  npx -p @vestra-player/sdk vestra-plugin docs --search "export"    paths that match
  npx -p @vestra-player/sdk vestra-plugin docs <path> --page 2      the rest of a long answer
Read /Guides/Tutorials/Getting started and the API of every member you use
before writing code.
```

### Know the paths

- `/Guides/<group>/<page>` is a page of this site: `/Guides/How-to/Test a plugin`. The page's file name works too, with or without `.md` (`/Guides/How-to/testing`), and so does a page's old title.
- `/API/<category>/<symbol>` is a declaration of `@vestra-player/sdk`, `@vestra-player/sdk/testing` or `@vestra-player/sdk/docs`, with its import line: `/API/Media/Snapshot`. `/API/Testing` holds the test host, `/API/Docs` this tree's own functions.
- `/API/<category>/<symbol>/<member>` is one member with its signature, parameters, return value, errors, capability, player version and examples: `/API/Media/Snapshot/dispose`. The SDK types a signature names are linked below it.
- Case, spaces and punctuation do not matter, the leading `/` is optional, and `.` works like `/`.
- A name alone finds its node, even when it is not at the level asked: `TestHost`, `TestHost.settle`, `plugin.player`, `/API/Snapshot`. A declaration wins over a guide page of a similar name; one segment that leads nowhere (a wrong category) is left out. When several nodes fit equally well, the answer lists them instead of guessing.
- `#heading` after a path opens the page of a long answer that has that section: `/Guides/Reference/Test host#acting-like-the-user`.
- A path that matches nothing answers with the nearest names and the contents of the level it reached.
- Links in the text are paths of the tree; a path with spaces is written in angle brackets, `[Test a plugin](</Guides/How-to/Test a plugin>)`, and the brackets may be passed along as they are. Files of the repository that are not pages link to GitHub.

In Git Bash on Windows the shell turns a leading `/API` into a Windows path (`C:/Program Files/Git/API`). `vestra-plugin docs` recognises Git Bash by its `MSYSTEM` variable and starts again at the tree's top level; writing the path without its leading `/` (`API/Media`) avoids the conversion altogether.

### Search when you do not know the path

`npx vestra-plugin docs --search <words>` lists the nodes that contain every word, each with its path and summary. Common words ("a", "the", "to") are left out; a name that matches ranks first, a declaration's before a page's, and a path that contains every word before one that does not. Search for the thing, not the question: `--search snapshot export`, `--search open window`.

### Read long answers in pages

An answer longer than 8 KB ends with `(Page 1 of 3. Read on with page 2 of …)`. Ask for the next one with `--page 2`. Page 1 of a long page lists its sections with the page each starts on. A code block cut by a page break is closed at the break and opened again on the next page, a short one moves to the next page whole, and a table cut by a break repeats its header row.

### Call it from a program

An agent that runs inside your own Node.js program, such as the player's Vestra Player AI, calls the same functions in process. `docs(path, { page })` and `searchDocs(query, { page })` return the text the command line prints.

## Complete example

A tool for an agent framework that answers with one node or a search:

```ts
import { docs, searchDocs, DOCS_PAGE_BYTES } from "@vestra-player/sdk/docs";

/** The agent's "read the SDK documentation" tool. */
export function readSdkDocs(input: {
  path?: string;
  search?: string;
  page?: number;
}): string {
  const page = input.page ?? 1;
  const text = input.search
    ? searchDocs(input.search, { page })
    : docs(input.path ?? "/", { page });
  // Never more than one page of text for the agent's context.
  console.assert(Buffer.byteLength(text) <= DOCS_PAGE_BYTES);
  return text;
}

console.log(readSdkDocs({ path: "/API/Media/Snapshot/dispose" }));
console.log(readSdkDocs({ search: "snapshot export" }));
```

## See also

- [Getting started](../tutorials/getting-started.md): the first page an agent should read.
- [Command line](../reference/cli.md): every `vestra-plugin` command.
- [Test a plugin](testing.md): how the agent checks what it wrote.
