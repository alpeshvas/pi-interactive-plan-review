# pi-inquire

pi-inquire turns plans, notes, specs, RFCs, recaps, research, diffs, and other structured content into reviewable HTML, then lets you ask questions and leave feedback directly inside the document.

It includes:

- a `human-review` skill that creates reviewable HTML from structured content
- a browser surface for comments, contextual questions, threaded discussion, and feedback submission

## Install

Pi packages can be installed from git, npm, or a local path. Git is the recommended install path once the repo is published/renamed.

### Try without installing

```bash
pi -e git:github.com/alpeshvas/pi-inquire
```

### Install globally

```bash
pi install git:github.com/alpeshvas/pi-inquire
```

### Install for a project

```bash
pi install -l git:github.com/alpeshvas/pi-inquire
```

### Local development

```bash
pi -e /Users/alpesh/codebase/pi-plan-review
pi install /Users/alpesh/codebase/pi-plan-review
pi install -l /Users/alpesh/codebase/pi-plan-review
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

Stop the active browser server:

```text
/annotate-html-stop
```

## Browser surface

In the browser, you can:

- click any block to ask Pi a question or leave feedback
- select text to add a targeted comment
- continue threaded Q&A on comments
- add general document-level notes
- edit or remove comments
- submit feedback back into the active Pi session

Pi answers using the document, selected block, existing comments, thread history, and recent session context.

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

## Output

Submitted feedback is saved under the active project:

```text
.pi/html-reviews/<document-name>/
```

Each submission writes:

```text
submissions/<timestamp>.json
submissions/<timestamp>.md
latest.json
latest.md
```

A summary is also sent back into the current Pi session.

## Tool

This package exposes:

```text
open_html_review
```

The `human-review` skill uses it automatically. Agents can also call it directly to open an HTML file in pi-inquire.

## Compatibility notes

For now, a few legacy names remain for compatibility:

- `/annotate-plan-html` remains an alias for `/annotate-html`
- submissions still write to `.pi/html-reviews/`
- the tool is still named `open_html_review`
