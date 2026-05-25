---
name: human-review-plan
description: Convert any plan text into a standardized, review-ready HTML plan with stable block ids for the pi-plan-review viewer, then prepare it for human review. Use whenever the user wants to take a written plan, spec, design doc, refactor proposal, or roadmap and produce an HTML version that can be reviewed block-by-block inside the browser review surface. Invoke via /skill:human-review-plan. Also use proactively when the user mentions "review the plan", "open this plan in the reviewer", "convert this plan", "make this plan reviewable", or shares a plan as text and follows up about reviewing it.
---

# human-review-plan

This skill produces **review-ready HTML plans** for the `pi-plan-review` extension and prepares them for human review. Output must always:

- be a complete, standalone HTML file
- contain stable `data-review-id` attributes on every review block
- use clean structure so block ids do not drift between revisions

## Default action on invocation

**When this skill is invoked, immediately execute the full flow. Do not just describe the skill or ask what to do.**

Steps to run by default:

1. Identify the plan source, in this priority order:
   1. If the user provided a path or inline plan text in the same message, use it.
   2. Otherwise, look back in the current conversation for the most recent substantive plan-like content from the assistant or user (an outline, design, architecture, spec, roadmap, refactor proposal, sequencing list, etc.).
   3. If multiple candidates exist, pick the **most recent** plan-like message.
   4. If absolutely no plan-like content is found in the current conversation, ask the user to paste it or give a path. Do not invent a plan.

2. Generate the HTML following the structure and rules below.

3. Save the file using the rules in the "File output" section.

4. **Immediately open it for review** by calling the `open_html_review` tool with the saved path. Do this every time, unless the user explicitly said "do not open" or "just generate".

5. Then tell the user:
   - the exact saved path
   - that the review surface is now open in the browser
   - they can also reopen later with: `/annotate-plan-html <path>`

Do not output the HTML inline in the chat. Always write to a file and open it.

## When to use

Use this skill when the user asks to:

- "review this plan in the browser"
- "open this plan for review"
- "turn this plan/spec/design doc into review HTML"
- "make this reviewable"
- "regenerate the plan HTML"
- prepare a plan for the `pi-plan-review` viewer

Also run automatically when invoked via `/skill:human-review-plan`, even with no extra prompt.

## Inputs

Accept any of:

- a path to a text/Markdown plan file
- raw plan text passed in the user message
- the last plan-like message in the current conversation

## Required output structure

The HTML must be standalone and self-contained.

```
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{{plan title}}</title>
  <style>
    /* inline minimal styles, see below */
  </style>
</head>
<body>
  <main class="plan" data-review-id="plan-root" data-review-title="{{plan title}}">
    <!-- review blocks here -->
  </main>
</body>
</html>
```

## Required review blocks

Always emit these top-level blocks **in this order**, even if a section is short. Use the exact `data-review-id` values below so feedback stays mappable across revisions:

| `data-review-id`       | Title              | Purpose                                  |
|------------------------|--------------------|------------------------------------------|
| `overview`             | Overview           | what the plan is and why it exists       |
| `goals`                | Goals              | explicit goals                            |
| `non-goals`            | Non-goals          | explicit non-goals                        |
| `architecture`         | Architecture       | structure, components, interfaces         |
| `flow`                 | Flow               | request/data/control flow                 |
| `interfaces`           | Interfaces         | concrete contracts, APIs, types           |
| `risks`                | Risks              | risks and mitigations                     |
| `sequencing`           | Sequencing         | phases, ordering, rollout                 |
| `open-questions`       | Open questions     | unknowns and decisions to resolve         |

If the input plan has no content for a section, still emit the block with a short note like `<p>None.</p>` so block ids remain stable across revisions.

## Inner block rules

- Wrap each top-level block in `<section data-review-id="..." data-review-title="...">`
- Use a single `<h2>` as the section heading
- For sub-blocks (e.g., individual phases, components, risks), use `<article data-review-id="..." data-review-title="...">` inside the section
- Sub-block ids should be **prefixed by the parent**, e.g.:
  - `risks-cache-invalidation`
  - `sequencing-phase-1`
  - `architecture-resource-resolver`
- Sub-block ids must be slug-style: lowercase, hyphenated, stable
- Never auto-number ids in a way that shifts when content is added (avoid `card-12`, prefer semantic names)

## Style

Inline minimal CSS, dark-friendly, no external assets. Keep it readable but plain — the review viewer is the primary surface.

Suggested base CSS:

```css
:root {
  --bg: #0b1220;
  --surface: #111a2e;
  --border: rgba(148,163,184,.24);
  --text: #e6edf5;
  --muted: #8ea0b8;
  --accent: #67d2e7;
  --font: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font-family: var(--font); line-height: 1.55; }
main.plan { max-width: 980px; margin: 0 auto; padding: 32px 24px 80px; display: grid; gap: 16px; }
section[data-review-id], article[data-review-id] {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 18px 20px;
}
section[data-review-id] > h2 { margin: 0 0 10px; font-size: 1.25rem; color: var(--text); }
article[data-review-id] { margin-top: 12px; }
article[data-review-id] > h3 { margin: 0 0 8px; font-size: 1.05rem; }
p, li { color: var(--muted); }
code { background: rgba(103,210,231,.08); color: var(--text); padding: 2px 6px; border-radius: 6px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .92em; }
ul { padding-left: 18px; margin: 8px 0 0; }
```

## File output

- Default save location: `~/.agent/diagrams/<slug>.html`
- `<slug>` is derived from the plan title (lowercase, hyphenated)
- If the user provides a path, use it instead
- If a file already exists at that location, **overwrite it** (this enables review→revise loops)

## After generation

Always finish by:

1. Calling the `open_html_review` tool with the saved path so the browser review surface opens automatically.
2. Telling the user:
   - the exact file path written
   - that the review is now open in the browser
   - the reopen command for later use:

     ```
     /annotate-plan-html <path>
     ```

Only skip the auto-open step if the user explicitly says they do not want it opened.

## Quality checks

Before returning, verify:

- every required top-level `data-review-id` is present
- ids are slug-style and stable
- the file is valid standalone HTML
- the file contains no external network assets
- sections without content still exist with a stub
- sub-block ids are prefixed by their parent block id
