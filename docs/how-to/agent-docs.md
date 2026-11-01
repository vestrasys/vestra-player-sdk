---
title: Give a coding agent the documentation
description: Let Claude Code, Cursor or your own agent read this documentation by path, like go doc, with vestra-plugin docs or @vestra-player/sdk/docs, a few kilobytes at a time.
---

# Give a coding agent the documentation

**Goal:** a coding agent writing a plugin reads exactly the part of this documentation it needs: the signature and errors of one method, one guide, the members of one interface.

The documentation is a tree of short nodes with the same pages and API as this site. `/` lists the top level; every node shows its text and then the paths one level down, each with a one-line summary, so an agent walks down from `/` or searches. Every answer is at most 8 KB; a longer one comes in pages. There is no single file with everything: an agent that loads a megabyte of reference reads none of it well.

## Steps

### Point the agent at the command line

In a project that depends on `@vestra-player/sdk`, any agent that can run commands reads the tree with `npx vestra-plugin docs`. Put this in the agent's instructions (`CLAUDE.md`, `AGENTS.md`, a Cursor rule):

```text
The Vestra Player SDK documentation is a tree read by path:
  npx vestra-plugin docs /                     the top level
  npx vestra-plugin docs /API/Media/Snapshot   an interface and its members
  npx vestra-plugin docs --search "export"     paths that match
  npx vestra-plugin docs <path> --page 2       the rest of a long answer
Read /Guides/Tutorials/Getting started and the API of every member you use
before writing code.
```

### Know the paths

- `/Guides/<group>/<page>` is a page of this site: `/Guides/How-to/Test a plugin`. The page's file name works too: `/Guides/How-to/testing`.
- `/API/<category>/<symbol>` is a declaration of `@vestra-player/sdk` or `@vestra-player/sdk/testing`, with its import line: `/API/Media/Snapshot`. `/API/Testing` holds the test host.
- `/API/<category>/<symbol>/<member>` is one member with its signature, parameters, return value, errors, capability, player version and examples: `/API/Media/Snapshot/dispose`.
- Case, spaces and punctuation do not matter, the leading `/` is optional, and a symbol's name alone finds it: `Snapshot`, `/API/Snapshot`.
- A path that matches nothing answers with the nearest names and the contents of the level it reached.

In Git Bash on Windows, write the path without its leading `/` (`API/Media`): the shell turns `/API` into a Windows path. `vestra-plugin docs` undoes that conversion when it can.

### Search when you do not know the path

`npx vestra-plugin docs --search <words>` lists the nodes that contain every word, names first, each with its path and summary. Search for the thing, not the question: `--search snapshot export`, `--search onError`.

### Read long answers in pages

An answer longer than 8 KB ends with `(Page 1 of 3. Read on with page 2 of …)`. Ask for the next one with `--page 2`. Code blocks cut by a page break are closed and reopened, so each page is valid Markdown.

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
