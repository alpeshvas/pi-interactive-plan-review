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

2. Decide the generation mode (see "Modes" below).

3. Generate the HTML following the structure and rules for that mode.

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

## Modes

Two modes are supported:

- **full** (default) — emits all required review blocks in order, uses full inline CSS, and is stable across revisions. Best for review → revise loops.
- **lite** — emits only the sections that actually exist in the input plan, skips structural stubs, uses minimal inline styling. Fastest to generate. Best for one-off reviews.

### How to pick the mode

Pick **lite** if any of these are true:

- the user passes `lite`, `--lite`, `mode=lite`, or similar as an argument to the skill invocation
- the user uses words like "quick", "fast", "lite", "light", "minimal", or "don't worry about formatting" in the same or immediately prior message
- the plan is very short (under ~30 lines of meaningful content) and the user did not explicitly ask for full

Otherwise pick **full**.

When unsure, prefer **full** for the first generation of a plan, and **lite** for re-runs in the same conversation.

### Lite mode rules

- Only emit top-level blocks that have real content from the input. Do not emit stubs.
- Still use stable `data-review-id` values from the required list below for any section you do emit.
- Sub-block ids still follow the parent-prefixed slug rule.
- Use a smaller base stylesheet (see "Style (lite)" below).
- Do not include sequencing, risks, or open-questions stubs unless the plan actually addresses them.
- Keep markup tight: no decorative wrappers, no unused classes.
- Skip any commentary or explanation HTML — just blocks.

Lite mode trades revision stability for speed. That's the intentional tradeoff.

## Required review blocks (full mode)

In **full** mode, always emit these top-level blocks **in this order**, even if a section is short. In **lite** mode, only emit the ones with real content, but still use these exact `data-review-id` values when you do emit them so feedback stays mappable:

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

In **full** mode, if the input plan has no content for a section, still emit the block with a short note like `<p>None.</p>` so block ids remain stable across revisions.

In **lite** mode, omit that section entirely.

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

## Visual primitives

Do **not** default to long paragraphs. Choose the right primitive for the content type. The goal is high information density and scannability, not a Markdown-in-browser feel.

The model must compose sections from these primitives. Every primitive uses pre-defined classes so the inline CSS stays small.

### Primitive selection rules

| Content shape | Use primitive |
|---|---|
| 3+ similar items (risks, components, modules, options) | **Card grid** (`.pr-grid`) |
| Ordered phases, rollout steps, request flow | **Step flow** (`.pr-steps`) |
| Short tags (goals, non-goals, scope flags) | **Pill list** (`.pr-pills`) |
| Interfaces, APIs, types, env vars, fields | **Definition table** (`.pr-deftable`) |
| Decisions, key insights, warnings | **Callout** (`.pr-callout`) |
| Two competing approaches, before/after, today/proposed | **Side-by-side** (`.pr-split`) |
| Long secondary detail under a top-level point | **Collapsible** (`<details class="pr-collapse">`) |
| Status of items (planned/done/blocked/open) | **Status chip** (`.pr-chip`) |
| More than ~4 top-level sections | **Sticky TOC** in a side rail (`.pr-toc`) |

When in doubt: prefer **card grid + callouts + pills** over paragraphs.

### Primitive markup

Use exactly these shapes. They are namespaced with `pr-` so they don't collide with the review viewer.

**Card grid**

```html
<div class="pr-grid">
  <article data-review-id="risks-cache-invalidation" data-review-title="Cache invalidation" class="pr-card">
    <h3>Cache invalidation</h3>
    <p>Short description.</p>
    <span class="pr-chip pr-chip-warn">Risk</span>
  </article>
</div>
```

**Step flow**

```html
<ol class="pr-steps">
  <li data-review-id="sequencing-phase-1" data-review-title="Phase 1">
    <strong>Phase 1</strong>
    <span>One-line outcome.</span>
  </li>
</ol>
```

**Pill list**

```html
<ul class="pr-pills">
  <li>Stable URL contract</li>
  <li>No viewport logic in v0</li>
</ul>
```

**Definition table**

```html
<dl class="pr-deftable">
  <dt><code>ResourceRequest</code></dt>
  <dd>Input contract for image fetches.</dd>
  <dt><code>ResourceDescriptor</code></dt>
  <dd>Resolved canonical asset reference.</dd>
</dl>
```

**Callout**

```html
<aside class="pr-callout pr-callout-info">
  <strong>Decision:</strong> Clients depend only on <code>ResourceRequest</code>.
</aside>
```

Callout variants: `pr-callout-info`, `pr-callout-warn`, `pr-callout-success`.

**Side-by-side**

```html
<div class="pr-split">
  <article class="pr-card">
    <h3>Today</h3>
    <p>One image serves all viewports.</p>
  </article>
  <article class="pr-card">
    <h3>Proposed</h3>
    <p>Resource layer abstracts variants.</p>
  </article>
</div>
```

**Collapsible secondary detail**

```html
<details class="pr-collapse">
  <summary>Implementation notes</summary>
  <p>Longer detail goes here.</p>
</details>
```

**Status chips**

```html
<span class="pr-chip pr-chip-ok">Planned</span>
<span class="pr-chip pr-chip-warn">Open question</span>
<span class="pr-chip pr-chip-info">Future</span>
<span class="pr-chip pr-chip-muted">Not in v0</span>
```

**Sticky TOC**

If there are 4+ top-level sections, emit a TOC at the start of `<main class="plan">`:

```html
<nav class="pr-toc" aria-label="Plan sections">
  <a href="#overview">Overview</a>
  <a href="#goals">Goals</a>
  <a href="#architecture">Architecture</a>
  <a href="#risks">Risks</a>
</nav>
```

Each corresponding `<section>` must have `id="..."` matching its `data-review-id` so anchors work.

### Composition rules

- Each top-level section should usually contain **at least one primitive other than a paragraph**.
- Avoid stacking 3+ paragraphs in a row. Convert them to a card grid, pills, or definition table.
- Push secondary detail into collapsibles, not paragraphs.
- Keep prose **short and declarative**. Density beats verbosity.
- Status of any item should be a chip, not a sentence.

## Style (full)

Inline minimal CSS, dark-friendly, no external assets. Keep it readable but plain — the review viewer is the primary surface.

Suggested base CSS (includes primitives):

```css
:root {
  --bg: #0b1220;
  --surface: #111a2e;
  --surface-2: #16213a;
  --border: rgba(148,163,184,.24);
  --text: #e6edf5;
  --muted: #8ea0b8;
  --accent: #67d2e7;
  --warn: #f5b56a;
  --ok: #6fe3a7;
  --info: #8ab6f6;
  --font: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --mono: ui-monospace, SFMono-Regular, Menlo, monospace;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font-family: var(--font); line-height: 1.55; }
main.plan { max-width: 980px; margin: 0 auto; padding: 24px 20px 80px; display: grid; gap: 16px; }
section[data-review-id] { background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 18px 20px; }
section[data-review-id] > h2 { margin: 0 0 12px; font-size: 1.15rem; color: var(--text); letter-spacing:.01em; }
article[data-review-id] { background: var(--surface-2); border: 1px solid var(--border); border-radius: 12px; padding: 12px 14px; }
article[data-review-id] > h3 { margin: 0 0 6px; font-size: .98rem; }
p, li, dd { color: var(--muted); }
p { margin: 6px 0; }
code { background: rgba(103,210,231,.08); color: var(--text); padding: 2px 6px; border-radius: 6px; font-family: var(--mono); font-size: .92em; }
ul { padding-left: 18px; margin: 6px 0 0; }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }

/* TOC */
.pr-toc { position: sticky; top: 12px; display: flex; flex-wrap: wrap; gap: 6px 12px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 12px; background: rgba(17,26,46,.9); backdrop-filter: blur(6px); font-size: .85rem; z-index: 5; }
.pr-toc a { color: var(--muted); }
.pr-toc a:hover { color: var(--text); }

/* Card grid */
.pr-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; margin-top: 8px; }
.pr-card { background: var(--surface-2); border: 1px solid var(--border); border-radius: 12px; padding: 12px 14px; display: grid; gap: 6px; }
.pr-card h3 { margin: 0; font-size: .98rem; }
.pr-card p { margin: 0; font-size: .9rem; }

/* Step flow */
.pr-steps { list-style: none; counter-reset: pr-step; padding: 0; margin: 8px 0 0; display: grid; gap: 8px; }
.pr-steps > li { counter-increment: pr-step; background: var(--surface-2); border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px 10px 40px; position: relative; display: grid; gap: 2px; }
.pr-steps > li::before { content: counter(pr-step); position: absolute; left: 10px; top: 10px; width: 22px; height: 22px; border-radius: 999px; background: var(--accent); color: #0b1220; font-weight: 700; font-size: .75rem; display: flex; align-items: center; justify-content: center; }
.pr-steps > li strong { font-size: .95rem; }
.pr-steps > li span { color: var(--muted); font-size: .9rem; }

/* Pill list */
.pr-pills { display: flex; flex-wrap: wrap; gap: 6px; list-style: none; padding: 0; margin: 8px 0 0; }
.pr-pills > li { background: rgba(103,210,231,.08); color: var(--text); border: 1px solid var(--border); border-radius: 999px; padding: 4px 10px; font-size: .82rem; }

/* Definition table */
.pr-deftable { display: grid; grid-template-columns: minmax(120px, max-content) 1fr; gap: 8px 14px; margin: 8px 0 0; }
.pr-deftable dt { color: var(--text); font-family: var(--mono); font-size: .85rem; }
.pr-deftable dd { margin: 0; color: var(--muted); font-size: .9rem; }

/* Callout */
.pr-callout { margin: 10px 0 0; padding: 10px 12px; border-left: 3px solid var(--info); background: rgba(138,182,246,.08); border-radius: 8px; font-size: .92rem; color: var(--text); }
.pr-callout-warn { border-left-color: var(--warn); background: rgba(245,181,106,.08); }
.pr-callout-success { border-left-color: var(--ok); background: rgba(111,227,167,.08); }

/* Split */
.pr-split { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 8px; }
@media (max-width: 720px) { .pr-split { grid-template-columns: 1fr; } }

/* Collapsible */
.pr-collapse { background: var(--surface-2); border: 1px solid var(--border); border-radius: 10px; padding: 0; margin-top: 8px; overflow: hidden; }
.pr-collapse > summary { list-style: none; cursor: pointer; padding: 10px 12px; font-weight: 600; color: var(--text); display: flex; align-items: center; gap: 8px; }
.pr-collapse > summary::before { content: "▸"; color: var(--muted); transition: transform .15s ease; }
.pr-collapse[open] > summary::before { transform: rotate(90deg); }
.pr-collapse > *:not(summary) { padding: 0 12px 12px; }

/* Chips */
.pr-chip { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: .72rem; font-weight: 600; letter-spacing: .02em; }
.pr-chip-ok { background: rgba(111,227,167,.15); color: var(--ok); }
.pr-chip-warn { background: rgba(245,181,106,.15); color: var(--warn); }
.pr-chip-info { background: rgba(138,182,246,.15); color: var(--info); }
.pr-chip-muted { background: rgba(148,163,184,.15); color: var(--muted); }
```

## Style (lite)

Lite mode should use a tiny base stylesheet so the model has less to emit:

```css
:root { color-scheme: dark; }
body { margin: 0; background: #0b1220; color: #e6edf5; font-family: ui-sans-serif, system-ui, sans-serif; line-height: 1.5; }
main.plan { max-width: 900px; margin: 0 auto; padding: 24px; display: grid; gap: 12px; }
section[data-review-id], article[data-review-id] { background: #111a2e; border: 1px solid rgba(148,163,184,.24); border-radius: 12px; padding: 14px 16px; }
h2 { margin: 0 0 8px; font-size: 1.15rem; }
h3 { margin: 0 0 6px; font-size: 1rem; }
p, li { color: #b6c2d2; margin: 4px 0; }
ul { padding-left: 18px; margin: 6px 0 0; }
```

Do not add anything else in lite mode.

## Inline interactivity

Add this tiny inline script just before `</body>` in **full** mode so the page feels interactive (no frameworks, no network):

```html
<script>
(()=>{
  const toc = document.querySelector('.pr-toc');
  if (toc) {
    toc.querySelectorAll('a[href^="#"]').forEach((a)=>{
      a.addEventListener('click',(e)=>{
        const id = a.getAttribute('href').slice(1);
        const target = document.getElementById(id);
        if (target) { e.preventDefault(); target.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      });
    });
  }
  // mark current section as user scrolls, for TOC highlight
  const sections = [...document.querySelectorAll('main.plan > section[id]')];
  if (sections.length && toc) {
    const links = new Map([...toc.querySelectorAll('a[href^="#"]')].map((a)=>[a.getAttribute('href').slice(1), a]));
    const io = new IntersectionObserver((entries)=>{
      entries.forEach((entry)=>{
        const link = links.get(entry.target.id);
        if (!link) return;
        if (entry.isIntersecting) {
          links.forEach((l)=>l.removeAttribute('data-active'));
          link.setAttribute('data-active','true');
        }
      });
    }, { rootMargin: '-30% 0px -60% 0px', threshold: 0 });
    sections.forEach((section)=>io.observe(section));
  }
})();
</script>
```

Also append this CSS to the inline stylesheet for TOC highlight:

```css
.pr-toc a[data-active="true"] { color: var(--text); font-weight: 600; }
```

Lite mode does **not** include this script or TOC.

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

- every required top-level `data-review-id` is present (full mode)
- each top-level `<section>` has both `id="<review-id>"` and `data-review-id="<review-id>"`
- ids are slug-style and stable
- the file is valid standalone HTML
- the file contains no external network assets
- sections without content still exist with a stub (full mode)
- sub-block ids are prefixed by their parent block id
- each top-level section uses **at least one visual primitive** when it has more than a single line of content
- if there are 4+ top-level sections, a sticky `<nav class="pr-toc">` is present at the top
- the inline interactivity script is present in full mode
