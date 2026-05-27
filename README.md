# pi-human-inquire

pi-human-inquire turns plans, notes, specs, RFCs, recaps, research, diffs, and other structured content into reviewable HTML where humans can ask agent questions and leave feedback directly inside the document.

It includes:

- a `human-review` skill that creates reviewable HTML from structured content
- a browser surface for comments, contextual questions, threaded discussion, and feedback submission

## Install

Pi packages can be installed from git, npm, or a local path. Git is the recommended install path once the repo is published/renamed.

### Try without installing

```bash
pi -e git:github.com/alpeshvas/pi-human-inquire
```

### Install globally

```bash
pi install git:github.com/alpeshvas/pi-human-inquire
```

### Install for a project

```bash
pi install -l git:github.com/alpeshvas/pi-human-inquire
```

## Usage

### Generate reviewable HTML from content

Use the skill:

```text
/skill:human-review
```

You can invoke it with no arguments, with a file path, or with an instruction:

```text
/skill:human-review notes.md
/skill:human-review turn this RFC into review HTML
/skill:human-review make the previous plan reviewable
```

The skill uses the provided content, or the most recent structured content in the conversation. It then creates an HTML file and opens it in the browser. If it cannot find suitable content, it asks you for a path or content.

### Open existing HTML

If you already have an HTML file:

```text
/annotate-html /absolute/path/to/document.html
```

Legacy alias:

```text
/annotate-plan-html /absolute/path/to/document.html
```

## Browser surface

In the opened HTML review page, you can:

- click any block to ask agent questions or leave feedback
- select text for comments
- continue threaded agent Q&A in place
- add document-level notes
- edit or remove comments
- submit feedback back into the active Pi session

Agent answers use the document, current block, selected text, existing comments, thread history, and recent session context.

## Architecture

```mermaid
flowchart TD
  P[Pi package manifest<br/>package.json pi.extensions + pi.skills] --> S[human-review skill<br/>/skill:human-review]
  P --> E[extension<br/>extensions/plan-review.ts]

  S --> H[Standalone review HTML<br/>~/.agent/diagrams/&lt;slug&gt;.html]
  S --> T[open_html_review tool]

  E --> C1[/annotate-html command]
  E --> C2[/annotate-plan-html alias]
  E --> T

  T --> L[launchReview path, ctx]
  C1 --> L
  C2 --> L

  L --> R[Temporary local server<br/>127.0.0.1 random port]
  R --> G[GET /<br/>serves source HTML + injected review UI]
  G --> B[Opened HTML review page]

  B --> UI[Injected side panel + inline composer]
  UI --> A[Block comments<br/>selected-text comments<br/>general notes]
  UI --> Q[Threaded agent Q&A]

  Q --> ASK[POST /api/ask]
  ASK --> M[Pi active model via complete]
  M --> CTX[Context used:<br/>document text + selected block + comments + thread + recent Pi session]
  CTX --> M
  M --> Q

  UI --> SUB[Submit feedback<br/>POST /api/submit]
  SUB --> FS[Saved locally<br/>.pi/html-reviews/&lt;document&gt;/]
  SUB --> FUP[pi.sendUserMessage<br/>deliverAs followUp]
  FUP --> PI[Active Pi session]
```

## Skill options

Use lite mode for quick/minimal output:

```text
/skill:human-review --lite notes.md
```

Use stubs when iterating on a plan or spec and you want sections to remain stable across revisions:

```text
/skill:human-review --with-stubs spec.md
```

By default, generated HTML is written to:

```text
~/.agent/diagrams/<slug>.html
```

## Feedback submission

Submitted feedback is saved locally and sent back into the active Pi session.

## Compatibility notes

For now, `/annotate-plan-html` remains an alias for `/annotate-html`.
