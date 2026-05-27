# pi-inquire

pi-inquire turns plans, notes, specs, RFCs, recaps, research, diffs, and other structured content into reviewable HTML, then lets you ask questions and leave feedback directly inside the document.

Use the included skill to generate review-ready HTML from structured content, or open an existing HTML document. Click any block to ask Pi contextual questions, discuss details in threads, add targeted comments, and submit structured feedback back into the active Pi session.

## Features

- Generates review-ready HTML from structured content with the included `human-review` skill
- Opens existing HTML documents in an interactive browser surface
- Adds a fixed side panel for notes, questions, and submission
- Lets users click any reviewable block to comment or ask Pi
- Supports targeted comments on selected text
- Supports threaded Q&A on each comment
- Answers questions using the selected block, document text, existing comments, thread history, and recent Pi session context
- Supports general document-level notes and an overall summary
- Shows comment badges on annotated blocks
- Lets users edit, remove, and revisit comments
- Saves submissions as JSON and Markdown
- Writes `latest.json` and `latest.md` snapshots
- Sends submitted feedback back into the active Pi session
- Runs a temporary local browser server and shuts it down after submission

## Commands

Primary command:

```bash
/annotate-html <path-to-html>
```

Compatibility alias:

```bash
/annotate-plan-html <path-to-html>
```

Stop the active browser server:

```bash
/annotate-html-stop
```

## Tool

- `open_html_review`

Use this tool when Pi should open reviewable HTML for in-page questions, comments, threaded discussion, and feedback submission.

## Skill

This package includes the `human-review` skill.

The skill converts structured content into standalone review-ready HTML with stable `data-review-id` blocks, then opens it in pi-inquire. Supported inputs include:

- plans
- notes
- specs
- RFCs
- design docs
- recaps
- research notes
- diff summaries
- post-mortems
- checklists
- other structured content

## Install

### Try directly from local path

```bash
pi -e /Users/alpesh/codebase/pi-inquire
```

### Install globally into Pi

```bash
pi install /Users/alpesh/codebase/pi-inquire
```

### Install project-local into Pi

```bash
pi install -l /Users/alpesh/codebase/pi-inquire
```

## Usage

Generate review-ready HTML from structured content with the `human-review` skill, or open an existing HTML document:

```bash
/annotate-html /absolute/path/to/document.html
```

Inside the browser surface, you can:

- click a block to leave feedback or ask Pi about that part
- select text to create a targeted comment
- add a general note with `+ Note`
- continue threaded Q&A from a comment card
- submit all notes back into the Pi session

## Output

Submissions are stored under the active project's:

```bash
.pi/html-reviews/<document-name>/
```

Each submission writes:

```text
submissions/<timestamp>.json
submissions/<timestamp>.md
latest.json
latest.md
```

After submission, pi-inquire also sends a summary back into the current Pi session.

## Reviewable HTML blocks

pi-inquire works best when the HTML contains stable review IDs:

```html
<section data-review-id="architecture" data-review-title="Architecture">
  ...
</section>
```

If IDs are missing, pi-inquire infers reviewable blocks from common document elements such as sections, articles, cards, phases, and API rows.

## Keyboard shortcuts

- `Cmd/Ctrl + Enter` in a composer: save or send
- `Esc` in a composer: cancel
- `Cmd/Ctrl + Enter` in the side panel: submit

## Compatibility notes

The package keeps a few legacy names for compatibility:

- `/annotate-plan-html` remains an alias for `/annotate-html`
- submissions still write to `.pi/html-reviews/`
- the tool is still named `open_html_review`
- generated review HTML may still use `class="plan"` as part of the review block contract
