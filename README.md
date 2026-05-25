# pi-plan-review

Pi package for reviewing generated HTML plans in the browser.

## Features

- Opens a local HTML plan in a browser review surface
- Lets you click a plan block and comment inline
- Keeps the sidebar minimal with overall review + compact comment list
- Saves submissions as JSON and Markdown
- Sends the submitted review back into the Pi session

## Commands

- `/annotate-html <path-to-html>`
- `/annotate-plan-html <path-to-html>`
- `/annotate-html-stop`

## Tool

- `open_html_review`

## Install

### Try directly from local path

```bash
pi -e /Users/alpesh/codebase/pi-plan-review
```

### Install globally into Pi

```bash
pi install /Users/alpesh/codebase/pi-plan-review
```

### Install project-local into Pi

```bash
pi install -l /Users/alpesh/codebase/pi-plan-review
```

## Usage

```bash
/annotate-plan-html /absolute/path/to/plan.html
```

Submissions are stored under the active project's:

```bash
.pi/html-reviews/<plan-name>/
```
