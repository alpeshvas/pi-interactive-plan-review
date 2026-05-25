// @ts-nocheck
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { createServer } from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const REVIEW_ROOT = ".pi/html-reviews";

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

function slugify(value: string): string {
	return value
		.toLowerCase()
		.replaceAll(/[^a-z0-9]+/g, "-")
		.replaceAll(/^-+|-+$/g, "")
		.slice(0, 80) || "review";
}

function buildReviewSummary(payload: any, jsonPath: string, markdownPath: string): string {
	const annotations = Array.isArray(payload?.annotations) ? payload.annotations : [];
	const lines = [
		`Plan review submitted for ${payload?.planFile ?? payload?.sourcePath ?? "unknown file"}.`,
		`Saved JSON: ${jsonPath}`,
		`Saved Markdown: ${markdownPath}`,
		`Overall summary: ${payload?.reviewSummary?.trim() || "(none)"}`,
		`Annotation count: ${annotations.length}`,
		"",
		"Annotations:",
	];

	for (const [index, annotation] of annotations.entries()) {
		const target = annotation.targetTitle || annotation.targetId || annotation.selector || "general";
		const snippet = annotation.textSnippet ? ` | snippet: ${annotation.textSnippet}` : "";
		lines.push(`${index + 1}. [${target}] ${annotation.comment ?? ""}${snippet}`);
	}

	return lines.join("\n");
}

function toMarkdown(payload: any, jsonPath: string): string {
	const annotations = Array.isArray(payload?.annotations) ? payload.annotations : [];
	const lines = [
		"# Plan Review Submission",
		"",
		`- Plan file: \`${payload?.planFile ?? payload?.sourcePath ?? "unknown"}\``,
		`- Submitted at: ${payload?.submittedAt ?? new Date().toISOString()}`,
		`- Saved JSON: \`${jsonPath}\``,
		`- Annotation count: ${annotations.length}`,
		"",
		"## Overall review",
		"",
		payload?.reviewSummary?.trim() || "(none)",
		"",
		"## Block comments",
		"",
	];

	if (annotations.length === 0) {
		lines.push("No annotations submitted.");
	}

	for (const [index, annotation] of annotations.entries()) {
		lines.push(`### ${index + 1}. ${annotation.targetTitle || annotation.targetId || "General comment"}`);
		lines.push("");
		lines.push(annotation.comment || "(empty)");
		lines.push("");
		if (annotation.targetId) lines.push(`- Target id: \`${annotation.targetId}\``);
		if (annotation.selector) lines.push(`- Selector: \`${annotation.selector}\``);
		if (annotation.textSnippet) lines.push(`- Snippet: ${annotation.textSnippet}`);
		if (annotation.createdAt) lines.push(`- Captured at: ${annotation.createdAt}`);
		lines.push("");
	}

	return lines.join("\n");
}

function buildSidebarMarkup(sourcePath: string) {
	return [
		'<aside id="pi-plan-review-panel">',
		'  <div id="pi-plan-review-header">',
		'    <div class="pi-review-kicker">Plan review</div>',
		'    <h1>Review this plan</h1>',
		`    <p>${escapeHtml(sourcePath)}</p>`,
		'  </div>',
		'  <div id="pi-plan-review-toolbar">',
		'    <button id="pi-toggle-mode" data-active="true">Review mode</button>',
		'    <button id="pi-clear-selection">Clear block</button>',
		'    <button id="pi-submit" data-kind="primary">Submit review</button>',
		'  </div>',
		'  <div id="pi-plan-review-body">',
		'    <div id="pi-plan-review-status"></div>',
		'    <section class="pi-review-section">',
		'      <label class="pi-review-label" for="pi-review-summary">Overall review</label>',
		'      <textarea id="pi-review-summary" class="pi-review-textarea pi-review-summary" placeholder="Overall take: approve, concerns, blockers, sequencing feedback, open questions..."></textarea>',
		'    </section>',
		'    <section class="pi-review-section">',
		'      <div class="pi-review-label">Selected block</div>',
		'      <div id="pi-current-target" class="pi-review-target-card">Click a review block in the page.</div>',
		'    </section>',
		'    <section class="pi-review-section">',
		'      <label class="pi-review-label" for="pi-review-comment">Comment on selected block</label>',
		'      <textarea id="pi-review-comment" class="pi-review-textarea" placeholder="What should change in this part of the plan?"></textarea>',
		'      <div class="pi-review-button-row">',
		'        <button id="pi-add-annotation" data-kind="primary">Add block comment</button>',
		'        <button id="pi-add-general">Add general comment</button>',
		'      </div>',
		'    </section>',
		'    <section class="pi-review-section">',
		'      <div class="pi-review-label">Reviewable blocks</div>',
		'      <div id="pi-review-blocks" class="pi-review-blocks"></div>',
		'    </section>',
		'    <section class="pi-review-section">',
		'      <div class="pi-review-label">Queued comments</div>',
		'      <div id="pi-review-annotations" class="pi-review-annotations"></div>',
		'    </section>',
		'  </div>',
		'</aside>',
	].join("");
}

function buildInjectedScript() {
	return String.raw`(()=>{
const root=document.getElementById('pi-plan-review-root');
if(!root)return;
const state={reviewMode:true,selected:null,hovered:null,annotations:[],blocks:[]};
const statusEl=document.getElementById('pi-plan-review-status');
const summaryEl=document.getElementById('pi-review-summary');
const currentTargetEl=document.getElementById('pi-current-target');
const commentEl=document.getElementById('pi-review-comment');
const blocksEl=document.getElementById('pi-review-blocks');
const annotationsEl=document.getElementById('pi-review-annotations');
const toggleButton=document.getElementById('pi-toggle-mode');
function slugify(value){return (value||'review').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,80)||'review';}
function escapeHtml(value){return String(value||'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');}
function showStatus(message,kind){statusEl.textContent=message;statusEl.dataset.visible='true';statusEl.dataset.kind=kind||'info';}
function clearStatus(){statusEl.dataset.visible='false';statusEl.dataset.kind='info';statusEl.textContent='';}
function textPreview(el){const text=(el?.innerText||el?.textContent||'').replace(/\s+/g,' ').trim();return text.slice(0,180);}
function findHeading(el){return el?.querySelector('h1,h2,h3,h4,.section-label,.eyebrow,.pill,strong');}
function reviewTitle(el){return el?.dataset.reviewTitle||findHeading(el)?.textContent?.replace(/\s+/g,' ').trim()||el?.getAttribute('aria-label')||el?.tagName?.toLowerCase()||'Block';}
function reviewSelector(el){if(el?.dataset.reviewId){return '[data-review-id="'+CSS.escape(el.dataset.reviewId)+'"]';}if(el?.id){return '#'+CSS.escape(el.id);}return el?.tagName?.toLowerCase()||'section';}
function gatherReviewBlocks(){const candidates=[...document.querySelectorAll('[data-review-id], main section, main article, .hero, .card, .step, .phase, .api-row')];const seen=new Set();const blocks=[];candidates.forEach((el,index)=>{if(!(el instanceof HTMLElement))return;if(el.closest('#pi-plan-review-root'))return;const area=el.getBoundingClientRect();if(area.width<80||area.height<36)return;let id=el.dataset.reviewId;if(!id){id=slugify(reviewTitle(el)+'-'+(index+1));el.dataset.reviewId=id;}if(seen.has(id))return;seen.add(id);if(!el.dataset.reviewTitle){el.dataset.reviewTitle=reviewTitle(el);}blocks.push(el);});return blocks;}
function renderBlockList(){if(state.blocks.length===0){blocksEl.innerHTML='<div class="pi-review-empty">No review blocks found.</div>';return;}blocksEl.innerHTML='';state.blocks.forEach((block)=>{const button=document.createElement('button');button.type='button';button.className='pi-review-block-item'+(state.selected===block?' is-selected':'');button.textContent=block.dataset.reviewTitle+' · '+block.dataset.reviewId;button.addEventListener('click',()=>{setSelected(block,true);});blocksEl.appendChild(button);});}
function clearHover(){if(state.hovered){state.hovered.classList.remove('pi-review-hover');state.hovered=null;}}
function setSelected(block,scroll){if(state.selected){state.selected.classList.remove('pi-review-selected');}state.selected=block||null;if(state.selected){state.selected.classList.add('pi-review-selected');currentTargetEl.innerHTML='<strong>'+escapeHtml(state.selected.dataset.reviewTitle||state.selected.dataset.reviewId||'Block')+'</strong><small>'+escapeHtml(state.selected.dataset.reviewId||'')+'</small><p>'+escapeHtml(textPreview(state.selected)||'No text preview')+'</p>';if(scroll){state.selected.scrollIntoView({behavior:'smooth',block:'center'});}}else{currentTargetEl.textContent='Click a review block in the page.';}renderBlockList();}
function renderAnnotations(){if(state.annotations.length===0){annotationsEl.innerHTML='<div class="pi-review-empty">No comments queued yet.</div>';return;}annotationsEl.innerHTML='';state.annotations.forEach((annotation)=>{const item=document.createElement('article');item.className='pi-review-annotation-item';item.innerHTML='<header><button type="button" class="pi-review-link">'+escapeHtml(annotation.targetTitle||annotation.targetId||'General comment')+'</button><button type="button" data-kind="danger" class="pi-review-remove">Remove</button></header><p>'+escapeHtml(annotation.comment)+'</p><small>'+escapeHtml(annotation.textSnippet||'General feedback')+'</small>';item.querySelector('.pi-review-link')?.addEventListener('click',()=>{if(annotation.targetId){const target=document.querySelector('[data-review-id="'+CSS.escape(annotation.targetId)+'"]');if(target){setSelected(target,true);}}});item.querySelector('.pi-review-remove')?.addEventListener('click',()=>{state.annotations=state.annotations.filter((entry)=>entry.id!==annotation.id);renderAnnotations();});annotationsEl.appendChild(item);});}
function addAnnotation(general){const comment=commentEl.value.trim();if(!comment){showStatus('Write a comment first.','error');return;}const target=general?null:state.selected;if(!general&&!target){showStatus('Select a review block first.','error');return;}state.annotations.push({id:crypto.randomUUID(),targetId:target?.dataset.reviewId||null,targetTitle:target?.dataset.reviewTitle||'General comment',selector:target?reviewSelector(target):null,textSnippet:target?textPreview(target):null,comment,createdAt:new Date().toISOString()});commentEl.value='';clearStatus();renderAnnotations();}
async function submitReview(){showStatus('Submitting review...','info');try{const payload={planFile:window.__PI_HTML_REVIEW__?.sourcePath,sourcePath:window.__PI_HTML_REVIEW__?.sourcePath,submittedAt:new Date().toISOString(),reviewSummary:summaryEl.value.trim(),annotations:state.annotations};const response=await fetch('/api/submit',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});const result=await response.json();if(!response.ok)throw new Error(result.error||'Submission failed');showStatus('Submitted '+result.annotationCount+' comments.','success');}catch(error){showStatus(error?.message||'Submission failed','error');}}
toggleButton.addEventListener('click',()=>{state.reviewMode=!state.reviewMode;toggleButton.dataset.active=String(state.reviewMode);toggleButton.textContent=state.reviewMode?'Review mode':'Browse mode';clearHover();});
document.getElementById('pi-clear-selection').addEventListener('click',()=>setSelected(null,false));
document.getElementById('pi-add-annotation').addEventListener('click',()=>addAnnotation(false));
document.getElementById('pi-add-general').addEventListener('click',()=>addAnnotation(true));
document.getElementById('pi-submit').addEventListener('click',submitReview);
document.addEventListener('mouseover',(event)=>{if(!state.reviewMode)return;const el=event.target instanceof HTMLElement?event.target.closest('[data-review-id]'):null;if(!el||el.closest('#pi-plan-review-root'))return;clearHover();state.hovered=el;el.classList.add('pi-review-hover');},true);
document.addEventListener('click',(event)=>{if(!state.reviewMode)return;const node=event.target instanceof HTMLElement?event.target:null;if(!node)return;if(node.closest('#pi-plan-review-root'))return;const block=node.closest('[data-review-id]');if(!block)return;event.preventDefault();event.stopPropagation();clearHover();setSelected(block,false);},true);
state.blocks=gatherReviewBlocks();
renderBlockList();
renderAnnotations();
if(state.blocks.length>0){setSelected(state.blocks[0],false);showStatus('Select any review block and add comments in the sidebar.','info');}else{showStatus('No structured blocks found. You can still add general comments.','info');}
})();`;
}

function injectReviewClient(html: string, config: { sourcePath: string }): string {
	const configScript = `<script>window.__PI_HTML_REVIEW__=${JSON.stringify(config)};</script>`;
	const sidebarMarkup = buildSidebarMarkup(config.sourcePath);
	const script = buildInjectedScript();
	const injected = `${configScript}
<style>
body{padding-right:min(34vw,430px)!important;padding-bottom:0!important;box-sizing:border-box;}
#pi-plan-review-root *{box-sizing:border-box;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
#pi-plan-review-root{position:fixed;top:0;right:0;bottom:0;width:min(34vw,430px);min-width:330px;z-index:2147483647;color:#0f172a}
#pi-plan-review-panel{height:100%;display:flex;flex-direction:column;background:rgba(255,255,255,.97);border-left:1px solid rgba(148,163,184,.35);box-shadow:0 20px 48px rgba(15,23,42,.18)}
#pi-plan-review-header{padding:16px 18px 14px;border-bottom:1px solid rgba(148,163,184,.35);background:linear-gradient(180deg,#ffffff,#f8fafc)}
#pi-plan-review-header h1{margin:4px 0 6px;font-size:21px;line-height:1.15}
#pi-plan-review-header p{margin:0;color:#475569;font-size:12px;word-break:break-word}
#pi-plan-review-toolbar{display:flex;gap:8px;flex-wrap:wrap;padding:12px 16px;border-bottom:1px solid rgba(148,163,184,.35);background:#fff}
#pi-plan-review-root button{border:1px solid rgba(148,163,184,.45);background:#fff;color:#0f172a;border-radius:10px;padding:9px 12px;font-size:12px;font-weight:600;cursor:pointer}
#pi-plan-review-root button[data-kind="primary"]{background:#0f766e;border-color:#0f766e;color:#fff}
#pi-plan-review-root button[data-kind="danger"]{color:#be123c}
#pi-plan-review-root button[data-active="true"]{outline:2px solid rgba(15,118,110,.18)}
#pi-plan-review-body{display:flex;flex-direction:column;gap:14px;overflow:auto;padding:16px;background:#f8fafc}
#pi-plan-review-status{display:none;padding:10px 12px;border-radius:12px;font-size:12px}
#pi-plan-review-status[data-visible="true"]{display:block}
#pi-plan-review-status[data-kind="info"]{background:#ecfeff;color:#155e75}
#pi-plan-review-status[data-kind="success"]{background:#ecfdf5;color:#065f46}
#pi-plan-review-status[data-kind="error"]{background:#fff1f2;color:#9f1239}
.pi-review-kicker{font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#0f766e}
.pi-review-section{display:grid;gap:8px}
.pi-review-label{font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#475569}
.pi-review-textarea{width:100%;min-height:120px;padding:12px;border:1px solid rgba(148,163,184,.4);border-radius:14px;background:#fff;color:#0f172a;font-size:13px;resize:vertical}
.pi-review-summary{min-height:90px}
.pi-review-target-card,.pi-review-empty{padding:12px;border:1px solid rgba(148,163,184,.35);border-radius:14px;background:#fff;color:#475569;font-size:13px}
.pi-review-target-card strong,.pi-review-target-card small,.pi-review-target-card p{display:block}
.pi-review-target-card strong{color:#0f172a;font-size:14px;margin-bottom:6px}
.pi-review-target-card small{color:#475569;margin-bottom:8px}
.pi-review-target-card p{margin:0;white-space:pre-wrap}
.pi-review-button-row{display:flex;gap:8px;flex-wrap:wrap}
.pi-review-blocks,.pi-review-annotations{display:flex;flex-direction:column;gap:8px}
.pi-review-block-item,.pi-review-annotation-item{width:100%;text-align:left}
.pi-review-block-item{padding:10px 12px;border-radius:12px;border:1px solid rgba(148,163,184,.35);background:#fff;color:#0f172a;font-size:12px;line-height:1.4}
.pi-review-block-item.is-selected{border-color:#0f766e;background:rgba(15,118,110,.08)}
.pi-review-annotation-item{padding:12px;border:1px solid rgba(148,163,184,.35);border-radius:14px;background:#fff}
.pi-review-annotation-item header{display:flex;justify-content:space-between;gap:8px;align-items:flex-start;margin-bottom:8px}
.pi-review-annotation-item p{margin:0 0 8px;font-size:13px;white-space:pre-wrap;color:#0f172a}
.pi-review-annotation-item small{display:block;color:#475569;font-size:11px}
.pi-review-link,.pi-review-remove{padding:0!important;border:none!important;background:none!important;border-radius:0!important}
.pi-review-link{color:#0f766e!important;text-align:left}
[data-review-id]{scroll-margin-top:32px}
.pi-review-hover{outline:3px dashed rgba(180,83,9,.75)!important;outline-offset:4px!important}
.pi-review-selected{outline:3px solid rgba(15,118,110,.85)!important;outline-offset:4px!important}
@media (max-width: 960px){body{padding-right:0!important;padding-bottom:52vh!important}#pi-plan-review-root{left:0;right:0;top:auto;width:100vw;min-width:0;height:52vh}}
</style>
<div id="pi-plan-review-root">${sidebarMarkup}</div>
<script>${script}</script>`;

	if (html.includes("</body>")) {
		return html.replace("</body>", `${injected}</body>`);
	}

	return `${html}${injected}`;
}

export default function (pi: ExtensionAPI) {
	const runtime: {
		server?: import("node:http").Server;
		port?: number;
		sourcePath?: string;
		reviewDir?: string;
	} = {};

	async function closeServer() {
		if (!runtime.server) return;
		const server = runtime.server;
		runtime.server = undefined;
		runtime.port = undefined;
		runtime.sourcePath = undefined;
		runtime.reviewDir = undefined;
		await new Promise<void>((resolve, reject) => {
			server.close((error) => {
				if (error) reject(error);
				else resolve();
			});
		});
	}

	async function openBrowser(url: string) {
		const commands = process.platform === "darwin" ? [["open", [url]]] : [["xdg-open", [url]]];
		for (const [command, args] of commands) {
			try {
				await execFileAsync(command, args);
				return;
			} catch {}
		}
	}

	async function launchReview(sourcePathInput: string, cwd: string) {
		const sourcePath = path.resolve(cwd, sourcePathInput);
		const sourceHtml = await fs.readFile(sourcePath, "utf8");
		const slug = slugify(path.basename(sourcePath, path.extname(sourcePath)));
		const reviewDir = path.join(cwd, REVIEW_ROOT, slug);
		const submissionsDir = path.join(reviewDir, "submissions");
		await fs.mkdir(submissionsDir, { recursive: true });

		await closeServer();

		const server = createServer(async (req, res) => {
			try {
				if (req.method === "GET" && (req.url === "/" || req.url === "")) {
					res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
					res.end(injectReviewClient(sourceHtml, { sourcePath }));
					return;
				}

				if (req.method === "POST" && req.url === "/api/submit") {
					const chunks: Buffer[] = [];
					for await (const chunk of req) {
						chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
					}
					const payload = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
					const submittedAt = payload?.submittedAt || new Date().toISOString();
					const stamp = submittedAt.replaceAll(/[:.]/g, "-");
					const jsonPath = path.join(submissionsDir, `${stamp}.json`);
					const markdownPath = path.join(submissionsDir, `${stamp}.md`);
					await fs.writeFile(jsonPath, JSON.stringify(payload, null, 2));
					await fs.writeFile(markdownPath, toMarkdown(payload, jsonPath));
					await fs.writeFile(path.join(reviewDir, "latest.json"), JSON.stringify(payload, null, 2));
					await fs.writeFile(path.join(reviewDir, "latest.md"), toMarkdown(payload, jsonPath));

					const summary = buildReviewSummary(payload, jsonPath, markdownPath);
					try {
						pi.sendUserMessage(summary, { deliverAs: "followUp" });
					} catch {}

					res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
					res.end(JSON.stringify({ ok: true, annotationCount: Array.isArray(payload.annotations) ? payload.annotations.length : 0, jsonPath, markdownPath }));
					return;
				}

				res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
				res.end(JSON.stringify({ error: "Not found" }));
			} catch (error: any) {
				if (!res.headersSent) {
					res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
					res.end(JSON.stringify({ error: error?.message ?? "Unknown error" }));
				}
			}
		});

		const port = await new Promise<number>((resolve, reject) => {
			server.once("error", reject);
			server.listen(0, "127.0.0.1", () => {
				const address = server.address();
				if (!address || typeof address === "string") {
					reject(new Error("Could not determine review server port"));
					return;
				}
				resolve(address.port);
			});
		});

		runtime.server = server;
		runtime.port = port;
		runtime.sourcePath = sourcePath;
		runtime.reviewDir = reviewDir;

		const url = `http://127.0.0.1:${port}`;
		await openBrowser(url);
		return { url, reviewDir, sourcePath };
	}

	const openReviewCommand = async (args: string, ctx: any) => {
		const fileArg = args.trim();
		if (!fileArg) {
			ctx.ui.notify("Usage: /annotate-html <path-to-html>", "error");
			return;
		}

		try {
			const result = await launchReview(fileArg, ctx.cwd);
			ctx.ui.notify(`Opened plan review: ${result.url}`, "info");
			ctx.ui.notify(`Review files will be saved in ${result.reviewDir}`, "info");
		} catch (error: any) {
			ctx.ui.notify(`Failed to open HTML review: ${error?.message ?? error}`, "error");
		}
	};

	pi.registerCommand("annotate-html", {
		description: "Open an HTML plan in a browser with review blocks and submission",
		handler: openReviewCommand,
	});

	pi.registerCommand("annotate-plan-html", {
		description: "Alias for /annotate-html",
		handler: openReviewCommand,
	});

	pi.registerCommand("annotate-html-stop", {
		description: "Stop the active HTML review server",
		handler: async (_args, ctx) => {
			if (!runtime.server) {
				ctx.ui.notify("No active HTML review server", "info");
				return;
			}
			await closeServer();
			ctx.ui.notify("Stopped HTML review server", "info");
		},
	});

	pi.registerTool({
		name: "open_html_review",
		label: "Open HTML Review",
		description: "Open a generated HTML plan in a browser with inline review support",
		promptSnippet: "Open a local HTML plan for human review and inline comments.",
		promptGuidelines: ["Use open_html_review when the user wants to review a generated HTML plan in the browser and submit feedback."],
		parameters: Type.Object({
			path: Type.String({ description: "Path to the HTML file to review" }),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const result = await launchReview(params.path, ctx.cwd);
			return {
				content: [{ type: "text", text: `Opened HTML review for ${result.sourcePath}. Review URL: ${result.url}` }],
				details: result,
			};
		},
	});

	pi.on("session_shutdown", async () => {
		await closeServer();
	});
}
