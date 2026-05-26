// @ts-nocheck
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { complete } from "@earendil-works/pi-ai";
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
		const conversation = Array.isArray(annotation.conversation) ? annotation.conversation : [];
		if (conversation.length > 0) {
			lines.push("   Inline Q&A:");
			for (const turn of conversation) {
				const role = turn?.role === "assistant" ? "Pi" : "Reviewer";
				lines.push(`   - ${role}: ${turn?.text || ""}`);
			}
		}
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
		const conversation = Array.isArray(annotation.conversation) ? annotation.conversation : [];
		if (conversation.length > 0) {
			lines.push("");
			lines.push("#### Inline Q&A");
			lines.push("");
			for (const turn of conversation) {
				const role = turn?.role === "assistant" ? "Pi" : "Reviewer";
				lines.push(`**${role}:** ${turn?.text || ""}`);
				lines.push("");
			}
		}
		lines.push("");
	}

	return lines.join("\n");
}

function stripHtml(html: string): string {
	return html
		.replaceAll(/<script[\s\S]*?<\/script>/gi, " ")
		.replaceAll(/<style[\s\S]*?<\/style>/gi, " ")
		.replaceAll(/<[^>]+>/g, " ")
		.replaceAll(/&nbsp;/g, " ")
		.replaceAll(/&amp;/g, "&")
		.replaceAll(/&lt;/g, "<")
		.replaceAll(/&gt;/g, ">")
		.replaceAll(/\s+/g, " ")
		.trim();
}

function truncateText(value: string, max = 12000): string {
	if (!value || value.length <= max) return value || "";
	return `${value.slice(0, Math.floor(max * 0.65))}\n\n…[truncated]…\n\n${value.slice(-Math.floor(max * 0.35))}`;
}

function extractMessageText(message: any): string {
	if (!message?.content) return "";
	if (typeof message.content === "string") return message.content;
	if (!Array.isArray(message.content)) return "";
	return message.content
		.filter((part: any) => part?.type === "text" && typeof part.text === "string")
		.map((part: any) => part.text)
		.join("\n");
}

function recentSessionContext(ctx: any): string {
	try {
		const branch = ctx.sessionManager.getBranch();
		const lines: string[] = [];
		for (const entry of branch.slice(-18)) {
			if (entry?.type !== "message") continue;
			const message = entry.message;
			if (!message || !["user", "assistant"].includes(message.role)) continue;
			const text = extractMessageText(message).trim();
			if (!text) continue;
			lines.push(`${message.role.toUpperCase()}: ${truncateText(text, 1800)}`);
		}
		return truncateText(lines.join("\n\n"), 12000);
	} catch {
		return "";
	}
}

async function answerReviewQuestion(ctx: any, sourceHtml: string, payload: any): Promise<string> {
	if (!ctx.model) throw new Error("No model selected in Pi");
	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
	if (!auth.ok || !auth.apiKey) throw new Error(auth.ok ? `No API key for ${ctx.model.provider}` : auth.error);

	const question = String(payload?.question || "").trim();
	if (!question) throw new Error("Question is required");

	const conversation = Array.isArray(payload?.conversation) ? payload.conversation : [];
	const annotations = Array.isArray(payload?.annotations) ? payload.annotations : [];
	const userText = [
		"Current Pi session context:",
		recentSessionContext(ctx) || "(none)",
		"",
		"HTML plan text:",
		truncateText(stripHtml(sourceHtml), 10000),
		"",
		"Selected review block:",
		`Title: ${payload?.targetTitle || payload?.targetId || "General comment"}`,
		`Snippet: ${payload?.textSnippet || "(none)"}`,
		`Reviewer comment: ${payload?.comment || "(none)"}`,
		"",
		"Existing inline Q&A for this comment:",
		conversation.map((turn: any) => `${turn?.role === "assistant" ? "Pi" : "Reviewer"}: ${turn?.text || ""}`).join("\n") || "(none)",
		"",
		"Other review annotations:",
		annotations.map((annotation: any, index: number) => `${index + 1}. [${annotation?.targetTitle || annotation?.targetId || "General"}] ${annotation?.comment || ""}`).join("\n") || "(none)",
		"",
		"Reviewer question:",
		question,
	].join("\n");

	const response = await complete(
		ctx.model,
		{
			systemPrompt: "You are Pi helping with an interactive HTML plan review. Answer the reviewer's question briefly and concretely using the current Pi session context, selected block, and existing comments. Do not modify files. If the context is insufficient, say what is missing. Keep the answer under 120 words unless the user asks for more.",
			messages: [{ role: "user", content: [{ type: "text", text: userText }], timestamp: Date.now() }],
		},
		{ apiKey: auth.apiKey, headers: auth.headers, signal: ctx.signal },
	);

	return response.content
		.filter((part: any) => part?.type === "text" && typeof part.text === "string")
		.map((part: any) => part.text)
		.join("\n")
		.trim() || "I couldn't produce an answer.";
}

function buildSidebarMarkup(sourcePath: string) {
	const filename = sourcePath.split("/").pop() || sourcePath;
	return [
		'<aside id="pi-plan-review-panel">',
		'  <div id="pi-plan-review-header">',
		`    <div class="pi-review-filename" title="${escapeHtml(sourcePath)}">${escapeHtml(filename)}</div>`,
		'    <button id="pi-add-general" class="pi-review-ghost" title="Add a general comment">+ Note</button>',
		'  </div>',
		'  <div id="pi-plan-review-comments">',
		'    <div id="pi-review-annotations" class="pi-review-annotations"></div>',
		'  </div>',
		'  <div id="pi-plan-review-footer">',
		'    <div id="pi-plan-review-status" role="status" aria-live="polite"></div>',
		'    <label class="pi-review-label" for="pi-review-summary">Overall</label>',
		'    <textarea id="pi-review-summary" class="pi-review-textarea pi-review-summary" placeholder="Overall take (optional)"></textarea>',
		'    <div class="pi-review-footer-actions">',
		'      <button id="pi-discard-all" class="pi-review-ghost" hidden>Discard all</button>',
		'      <button id="pi-submit" data-kind="primary">Submit</button>',
		'    </div>',
		'  </div>',
		'</aside>',
	].join("");
}

function buildInjectedScript() {
	return String.raw`(()=>{
const root=document.getElementById('pi-plan-review-root');
if(!root)return;
const state={reviewMode:true,selected:null,hovered:null,annotations:[],blocks:[],composer:null,editingId:null,composerAnchor:null,composerMode:null,composerConversation:null,lastClick:null,statusTimer:null,recentId:null,recentTimer:null,pendingSnippet:null,pendingMarkId:null,pendingAnnotationId:null,selectionPopover:null};
const statusEl=document.getElementById('pi-plan-review-status');
const summaryEl=document.getElementById('pi-review-summary');
const annotationsEl=document.getElementById('pi-review-annotations');
const submitButton=document.getElementById('pi-submit');
const discardButton=document.getElementById('pi-discard-all');
const COMPOSER_GAP=14;
const COMPOSER_WIDTH=320;
function slugify(value){return (value||'review').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,80)||'review';}
function escapeHtml(value){return String(value||'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');}
function showStatus(message,kind){statusEl.textContent=message;statusEl.dataset.visible='true';statusEl.dataset.kind=kind||'info';if(state.statusTimer){clearTimeout(state.statusTimer);state.statusTimer=null;}if(kind==='success'||kind==='info'){state.statusTimer=setTimeout(clearStatus,1800);}}
function clearStatus(){statusEl.dataset.visible='false';statusEl.dataset.kind='info';statusEl.textContent='';if(state.statusTimer){clearTimeout(state.statusTimer);state.statusTimer=null;}}
function textPreview(el){const text=(el?.innerText||el?.textContent||'').replace(/\s+/g,' ').trim();return text.slice(0,180);}
function findHeading(el){return el?.querySelector('h1,h2,h3,h4,.section-label,.eyebrow,.pill,strong');}
function reviewTitle(el){return el?.dataset.reviewTitle||findHeading(el)?.textContent?.replace(/\s+/g,' ').trim()||el?.getAttribute('aria-label')||el?.tagName?.toLowerCase()||'Block';}
function reviewSelector(el){if(el?.dataset.reviewId){return '[data-review-id="'+CSS.escape(el.dataset.reviewId)+'"]';}if(el?.id){return '#'+CSS.escape(el.id);}return el?.tagName?.toLowerCase()||'section';}
function gatherReviewBlocks(){const candidates=[...document.querySelectorAll('[data-review-id], main section, main article, .hero, .card, .step, .phase, .api-row')];const seen=new Set();const blocks=[];candidates.forEach((el,index)=>{if(!(el instanceof HTMLElement))return;if(el.closest('#pi-plan-review-root'))return;const area=el.getBoundingClientRect();if(area.width<80||area.height<36)return;let id=el.dataset.reviewId;if(!id){id=slugify(reviewTitle(el)+'-'+(index+1));el.dataset.reviewId=id;}if(seen.has(id))return;seen.add(id);if(!el.dataset.reviewTitle){el.dataset.reviewTitle=reviewTitle(el);}blocks.push(el);});return blocks;}
function clearHover(){if(state.hovered){state.hovered.classList.remove('pi-review-hover');state.hovered=null;}}
function clearSelected(){if(state.selected){state.selected.classList.remove('pi-review-selected');state.selected=null;}}
function closeComposer(){if(state.composer){state.composer.remove();state.composer=null;}state.editingId=null;state.composerAnchor=null;state.composerMode=null;state.composerConversation=null;window.removeEventListener('resize',positionComposer);window.removeEventListener('scroll',positionComposer,true);}
function commentCountForBlock(block){return state.annotations.filter((annotation)=>annotation.targetId===block?.dataset?.reviewId).length;}
function syncReviewMeta(){const count=state.annotations.length;if(submitButton){submitButton.textContent=count>0?('Submit '+count+' '+(count===1?'comment':'comments')):'Submit';submitButton.disabled=count===0&&!summaryEl.value.trim();}if(discardButton){discardButton.hidden=count===0;}}
function updateBadges(){state.blocks.forEach((block)=>{let badge=block.querySelector(':scope > .pi-review-badge');const count=commentCountForBlock(block);if(count===0){badge?.remove();return;}if(!badge){badge=document.createElement('div');badge.className='pi-review-badge';block.appendChild(badge);}badge.textContent=String(count);});syncReviewMeta();}
function buildComposerMarkup(title,existingComment,snippet){const snippetHtml=snippet?'<blockquote class="pi-inline-snippet">'+escapeHtml(snippet.length>240?snippet.slice(0,240)+'…':snippet)+'</blockquote>':'';return '<div class="pi-inline-composer-card"><div class="pi-inline-composer-header"><strong>'+escapeHtml(title)+'</strong><button type="button" class="pi-inline-close" aria-label="Close">×</button></div>'+snippetHtml+'<textarea class="pi-inline-textarea" placeholder="Comment, or ask Pi about this part...">'+escapeHtml(existingComment||'')+'</textarea><div class="pi-composer-thread"></div><div class="pi-inline-actions"><div class="pi-inline-hint">⌘↵ save · Esc cancel</div><div class="pi-inline-buttons"><button type="button" class="pi-inline-ask">Ask Pi</button><button type="button" class="pi-inline-save">Save</button></div></div></div>';}
function upsertAnnotation(block,comment){const existingIndex=state.editingId?state.annotations.findIndex((annotation)=>annotation.id===state.editingId):-1;const useSnippet=state.pendingSnippet||(existingIndex>=0?state.annotations[existingIndex].textSnippet:null)||(block?textPreview(block):null);const useMarkId=state.pendingMarkId||(existingIndex>=0?state.annotations[existingIndex].markId:null)||null;const useId=state.pendingAnnotationId||(existingIndex>=0?state.annotations[existingIndex].id:crypto.randomUUID());const existingConversation=state.composerConversation||(existingIndex>=0&&Array.isArray(state.annotations[existingIndex].conversation)?state.annotations[existingIndex].conversation:[]);const payload={id:useId,targetId:block?.dataset?.reviewId||null,targetTitle:block?.dataset?.reviewTitle||'General comment',selector:block?reviewSelector(block):null,textSnippet:useSnippet,markId:useMarkId,comment,conversation:existingConversation,createdAt:new Date().toISOString()};state.pendingSnippet=null;state.pendingMarkId=null;state.pendingAnnotationId=null;if(existingIndex>=0){state.annotations.splice(existingIndex,1,payload);}else{state.annotations.push(payload);}state.recentId=payload.id;if(state.recentTimer){clearTimeout(state.recentTimer);}state.recentTimer=setTimeout(()=>{state.recentId=null;renderAnnotations();},4000);renderAnnotations();updateBadges();}
function positionComposer(){if(!state.composer||!state.composerAnchor||state.composerMode!=='block')return;const pop=state.composer;const rect=state.composerAnchor.getBoundingClientRect();const viewportWidth=window.innerWidth;const viewportHeight=window.innerHeight;const reviewPanel=document.getElementById('pi-plan-review-root');const panelRect=reviewPanel?.getBoundingClientRect();const contentRight=panelRect?Math.max(12,panelRect.left-COMPOSER_GAP):viewportWidth-12;const contentWidth=Math.max(280,contentRight-24);const panelWidth=Math.min(Math.max(COMPOSER_WIDTH,280),Math.min(360,contentWidth));pop.style.width=panelWidth+'px';pop.style.maxWidth='calc(100vw - 24px)';const popRect=pop.getBoundingClientRect();const width=popRect.width||panelWidth;const height=popRect.height||260;const rightSpace=Math.max(0,contentRight-rect.right-COMPOSER_GAP);const leftSpace=Math.max(0,rect.left-COMPOSER_GAP-12);const belowSpace=Math.max(0,viewportHeight-rect.bottom-COMPOSER_GAP-12);const aboveSpace=Math.max(0,rect.top-COMPOSER_GAP-12);let placement='bottom';if(belowSpace>=height){placement='bottom';}else if(aboveSpace>=height){placement='top';}else if(leftSpace>=width){placement='left';}else if(rightSpace>=width){placement='right';}else{const spaces=[['bottom',belowSpace],['top',aboveSpace],['left',leftSpace],['right',rightSpace]].sort((a,b)=>b[1]-a[1]);placement=spaces[0][0];}const clickX=state.lastClick?.x ?? (rect.left + rect.width / 2);let top=rect.bottom+COMPOSER_GAP;let left=clickX-(width/2);if(placement==='top'){top=rect.top-height-COMPOSER_GAP;left=clickX-(width/2);}else if(placement==='left'){left=rect.left-width-COMPOSER_GAP;top=Math.min(Math.max(12,rect.top),viewportHeight-height-12);}else if(placement==='right'){left=rect.right+COMPOSER_GAP;top=Math.min(Math.max(12,rect.top),viewportHeight-height-12);}left=Math.min(Math.max(12,left),Math.max(12,contentRight-width));top=Math.min(Math.max(12,top),viewportHeight-height-12);pop.style.left=left+'px';pop.style.top=top+'px';pop.dataset.placement=placement;}
function renderComposerThread(wrapper){const thread=wrapper.querySelector('.pi-composer-thread');if(!thread)return;const conversation=Array.isArray(state.composerConversation)?state.composerConversation:[];const textarea=wrapper.querySelector('.pi-inline-textarea');const askButton=wrapper.querySelector('.pi-inline-ask');wrapper.classList.toggle('pi-composer-chatting',conversation.length>0);if(textarea&&conversation.length>0&&thread.nextSibling!==textarea){thread.parentNode.insertBefore(textarea,thread.nextSibling);}if(askButton&&!askButton.disabled){askButton.textContent=conversation.length>0?'Reply':'Ask Pi';}if(textarea&&conversation.length>0){textarea.placeholder='Reply…';}thread.innerHTML='';conversation.forEach((turn)=>{const bubble=document.createElement('div');bubble.className='pi-qa-bubble '+(turn.role==='assistant'?'pi-qa-assistant':'pi-qa-user');if(turn.isError)bubble.dataset.error='true';bubble.textContent=(turn.role==='assistant'?'Pi: ':'You: ')+(turn.text||'');thread.appendChild(bubble);});positionComposer();}
function openComposer(block,annotation,opts){if(!block)return;clearSelected();closeComposer();state.selected=block;block.classList.add('pi-review-selected');const wrapper=document.createElement('div');wrapper.className='pi-inline-composer';const composerTitle=(opts&&opts.title)||block.dataset.reviewTitle||block.dataset.reviewId||'Block';const composerSnippet=(opts&&opts.snippet)||annotation?.textSnippet||state.pendingSnippet||null;wrapper.innerHTML=buildComposerMarkup(composerTitle,annotation?.comment||'',composerSnippet);document.body.appendChild(wrapper);state.composer=wrapper;state.composerAnchor=block;state.composerMode='block';state.editingId=annotation?.id||null;state.composerConversation=Array.isArray(annotation?.conversation)?annotation.conversation:[];renderComposerThread(wrapper);const textarea=wrapper.querySelector('.pi-inline-textarea');const cancelPendingMark=()=>{if(state.pendingMarkId&&!annotation){const mark=document.querySelector('mark.pi-review-mark[data-annotation-id="'+CSS.escape(state.pendingMarkId)+'"]');if(mark){const parent=mark.parentNode;while(mark.firstChild)parent.insertBefore(mark.firstChild,mark);parent.removeChild(mark);parent.normalize&&parent.normalize();}}state.pendingSnippet=null;state.pendingMarkId=null;state.pendingAnnotationId=null;};const save=()=>{let comment=textarea.value.trim();if(!comment&&Array.isArray(state.composerConversation)&&state.composerConversation.length>0){const lastQuestion=[...state.composerConversation].reverse().find((turn)=>turn.role==='user');comment=lastQuestion?.text||'Inline Q&A';}if(!comment){showStatus('Write a comment first.','error');return;}upsertAnnotation(block,comment);closeComposer();clearStatus();showStatus('Comment saved.','success');clearSelected();};const ask=async()=>{const question=textarea.value.trim();if(!question){showStatus('Write a question first.','error');return;}const askButton=wrapper.querySelector('.pi-inline-ask');if(askButton?.disabled)return;state.composerConversation=Array.isArray(state.composerConversation)?state.composerConversation:[];state.composerConversation.push({role:'user',text:question,createdAt:new Date().toISOString()});const thinking={role:'assistant',text:'Thinking…',createdAt:new Date().toISOString(),pending:true};state.composerConversation.push(thinking);textarea.value='';textarea.placeholder='Reply…';textarea.style.height='auto';if(askButton){askButton.disabled=true;askButton.textContent='Asking...';}renderComposerThread(wrapper);showStatus('Asking Pi...','info');try{const response=await fetch('/api/ask',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({question,targetId:block?.dataset?.reviewId||null,targetTitle:block?.dataset?.reviewTitle||composerTitle,textSnippet:composerSnippet||(block?textPreview(block):null),comment:annotation?.comment||question,conversation:state.composerConversation.filter((turn)=>!turn.pending),annotations:state.annotations})});const result=await response.json();if(!response.ok)throw new Error(result.error||'Pi could not answer');thinking.text=result.answer||'';delete thinking.pending;renderComposerThread(wrapper);showStatus('Pi answered.','success');}catch(error){thinking.text='Could not answer: '+(error?.message||error);thinking.isError=true;delete thinking.pending;renderComposerThread(wrapper);showStatus(error?.message||'Pi could not answer','error');}finally{if(askButton){askButton.disabled=false;askButton.textContent=(Array.isArray(state.composerConversation)&&state.composerConversation.length>0)?'Reply':'Ask Pi';}textarea.focus();}};const resizeTextarea=()=>{textarea.style.height='auto';const max=wrapper.classList.contains('pi-composer-chatting')?96:220;textarea.style.height=Math.min(textarea.scrollHeight,max)+'px';};wrapper.querySelector('.pi-inline-save')?.addEventListener('click',save);wrapper.querySelector('.pi-inline-ask')?.addEventListener('click',ask);wrapper.querySelector('.pi-inline-close')?.addEventListener('click',()=>{cancelPendingMark();closeComposer();clearSelected();});textarea.addEventListener('input',resizeTextarea);textarea.addEventListener('keydown',(event)=>{if((event.metaKey||event.ctrlKey)&&event.key==='Enter'){event.preventDefault();if(Array.isArray(state.composerConversation)&&state.composerConversation.length>0)ask();else save();}if(event.key==='Escape'){event.preventDefault();if(wrapper.classList.contains('pi-composer-chatting')){textarea.value='';resizeTextarea();textarea.blur();}else{cancelPendingMark();closeComposer();clearSelected();}}});positionComposer();window.addEventListener('resize',positionComposer);window.addEventListener('scroll',positionComposer,true);textarea.focus();textarea.setSelectionRange(textarea.value.length,textarea.value.length);resizeTextarea();}
async function askPi(annotation,question,askButton){question=(question||'').trim();if(!question){showStatus('Write a question first.','error');return;}annotation.conversation=Array.isArray(annotation.conversation)?annotation.conversation:[];annotation.conversation.push({role:'user',text:question,createdAt:new Date().toISOString()});renderAnnotations();showStatus('Asking Pi...','info');try{const response=await fetch('/api/ask',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({question,targetId:annotation.targetId,targetTitle:annotation.targetTitle,textSnippet:annotation.textSnippet,comment:annotation.comment,conversation:annotation.conversation,annotations:state.annotations})});const result=await response.json();if(!response.ok)throw new Error(result.error||'Pi could not answer');annotation.conversation.push({role:'assistant',text:result.answer||'',createdAt:new Date().toISOString()});renderAnnotations();showStatus('Pi answered.','success');}catch(error){annotation.conversation.push({role:'assistant',text:'Could not answer: '+(error?.message||error),createdAt:new Date().toISOString(),isError:true});renderAnnotations();showStatus(error?.message||'Pi could not answer','error');}}
function renderThread(annotation){const conversation=Array.isArray(annotation.conversation)?annotation.conversation:[];const wrap=document.createElement('div');wrap.className='pi-qa-thread';conversation.forEach((turn)=>{const bubble=document.createElement('div');bubble.className='pi-qa-bubble '+(turn.role==='assistant'?'pi-qa-assistant':'pi-qa-user');if(turn.isError)bubble.dataset.error='true';bubble.textContent=(turn.role==='assistant'?'Pi: ':'You: ')+(turn.text||'');wrap.appendChild(bubble);});const form=document.createElement('div');form.className='pi-qa-form';form.innerHTML='<textarea class="pi-qa-input" placeholder="Ask Pi about this comment..."></textarea><button type="button" class="pi-qa-send">Ask</button>';const input=form.querySelector('.pi-qa-input');const send=form.querySelector('.pi-qa-send');const submit=()=>{const value=input.value.trim();if(!value)return;input.value='';askPi(annotation,value,send);};send.addEventListener('click',submit);input.addEventListener('keydown',(event)=>{if((event.metaKey||event.ctrlKey)&&event.key==='Enter'){event.preventDefault();submit();}});wrap.appendChild(form);return wrap;}
function renderAnnotations(){syncReviewMeta();if(state.annotations.length===0){annotationsEl.innerHTML='<div class="pi-review-empty"><div class="pi-review-empty-icon">·</div><div>Click any block in the plan to leave a note.</div></div>';return;}annotationsEl.innerHTML='';state.annotations.forEach((annotation)=>{annotation.conversation=Array.isArray(annotation.conversation)?annotation.conversation:[];const item=document.createElement('article');item.className='pi-comment-card';if(annotation.id===state.recentId){item.dataset.recent='true';}const snippetHtml=annotation.markId&&annotation.textSnippet?'<div class="pi-comment-snippet">“'+escapeHtml(annotation.textSnippet.slice(0,140))+(annotation.textSnippet.length>140?'…':'')+'”</div>':'';item.innerHTML='<button type="button" class="pi-comment-anchor">→ '+escapeHtml(annotation.targetTitle||annotation.targetId||'General comment')+(annotation.markId?' · selection':'')+'</button>'+snippetHtml+'<p class="pi-comment-body">'+escapeHtml(annotation.comment)+'</p><div class="pi-comment-actions"><button type="button" class="pi-review-edit">Edit</button><button type="button" class="pi-review-ask">Ask Pi</button><button type="button" class="pi-review-remove">Remove</button></div>';const focusBlock=()=>{if(annotation.markId){const mark=document.querySelector('mark.pi-review-mark[data-annotation-id="'+CSS.escape(annotation.markId)+'"]');if(mark){mark.scrollIntoView({behavior:'smooth',block:'center'});mark.classList.add('pi-review-mark-pulse');setTimeout(()=>mark.classList.remove('pi-review-mark-pulse'),1200);state.pendingAnnotationId=annotation.id;state.pendingMarkId=annotation.markId;state.pendingSnippet=annotation.textSnippet;const block=mark.closest('[data-review-id]')||state.blocks[0];openComposer(block,annotation,{title:'Edit comment on selection'});return;}}if(annotation.targetId){const target=document.querySelector('[data-review-id="'+CSS.escape(annotation.targetId)+'"]');if(target){target.scrollIntoView({behavior:'smooth',block:'center'});openComposer(target,annotation);}}};item.querySelector('.pi-comment-anchor')?.addEventListener('click',focusBlock);item.querySelector('.pi-review-edit')?.addEventListener('click',focusBlock);item.querySelector('.pi-review-ask')?.addEventListener('click',()=>{item.classList.toggle('pi-qa-open');const input=item.querySelector('.pi-qa-input');if(input&&item.classList.contains('pi-qa-open'))input.focus();});item.querySelector('.pi-review-remove')?.addEventListener('click',()=>{if(annotation.markId){const mark=document.querySelector('mark.pi-review-mark[data-annotation-id="'+CSS.escape(annotation.markId)+'"]');if(mark){const parent=mark.parentNode;while(mark.firstChild)parent.insertBefore(mark.firstChild,mark);parent.removeChild(mark);parent.normalize&&parent.normalize();}}state.annotations=state.annotations.filter((entry)=>entry.id!==annotation.id);renderAnnotations();updateBadges();});item.appendChild(renderThread(annotation));if(annotation.conversation.length>0)item.classList.add('pi-qa-open');annotationsEl.appendChild(item);});}
function addGeneralComment(){const existing={id:crypto.randomUUID(),targetId:null,targetTitle:'General comment',comment:'',textSnippet:null};closeComposer();clearSelected();const drawer=document.createElement('div');drawer.className='pi-global-composer';drawer.innerHTML='<div class="pi-inline-composer-card"><div class="pi-inline-composer-header"><strong>General comment</strong><button type="button" class="pi-inline-close" aria-label="Close">×</button></div><textarea class="pi-inline-textarea" placeholder="General feedback about the plan"></textarea><div class="pi-inline-actions"><div class="pi-inline-hint">⌘↵ save · Esc cancel</div><button type="button" class="pi-inline-save">Save</button></div></div>';document.body.appendChild(drawer);state.composer=drawer;state.composerMode='general';state.editingId=existing.id;const textarea=drawer.querySelector('.pi-inline-textarea');const close=()=>{closeComposer();};const save=()=>{const comment=textarea.value.trim();if(!comment){showStatus('Write a comment first.','error');return;}state.annotations.push({...existing,comment,conversation:[],createdAt:new Date().toISOString()});renderAnnotations();close();clearStatus();showStatus('General comment saved.','success');};drawer.querySelector('.pi-inline-save')?.addEventListener('click',save);drawer.querySelector('.pi-inline-close')?.addEventListener('click',close);textarea.addEventListener('keydown',(event)=>{if((event.metaKey||event.ctrlKey)&&event.key==='Enter'){event.preventDefault();save();}if(event.key==='Escape'){event.preventDefault();close();}});textarea.focus();}
function showSubmittedOverlay(count){const overlay=document.createElement('div');overlay.id='pi-submitted-overlay';overlay.innerHTML='<div class="pi-submitted-card"><div class="pi-submitted-check">✓</div><h2>Review submitted</h2><p>'+count+' '+(count===1?'comment':'comments')+' sent back to Pi.</p><p class="pi-submitted-hint">You can close this tab.</p><button type="button" id="pi-submitted-close">Close tab</button></div>';document.body.appendChild(overlay);const tryClose=()=>{try{window.close();}catch(e){}};document.getElementById('pi-submitted-close')?.addEventListener('click',tryClose);setTimeout(tryClose,400);}
async function submitReview(){if(submitButton)submitButton.disabled=true;showStatus('Submitting...','info');try{const payload={planFile:window.__PI_HTML_REVIEW__?.sourcePath,sourcePath:window.__PI_HTML_REVIEW__?.sourcePath,submittedAt:new Date().toISOString(),reviewSummary:summaryEl.value.trim(),annotations:state.annotations};const response=await fetch('/api/submit',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});const result=await response.json();if(!response.ok)throw new Error(result.error||'Submission failed');closeComposer();clearSelected();showSubmittedOverlay(result.annotationCount||0);}catch(error){if(submitButton)submitButton.disabled=false;showStatus(error?.message||'Submission failed','error');}}
document.getElementById('pi-add-general')?.addEventListener('click',addGeneralComment);
submitButton?.addEventListener('click',submitReview);
summaryEl?.addEventListener('input',syncReviewMeta);
discardButton?.addEventListener('click',()=>{if(state.annotations.length===0)return;if(!confirm('Discard all '+state.annotations.length+' comments?'))return;state.annotations=[];renderAnnotations();updateBadges();showStatus('All comments discarded.','info');});
document.addEventListener('keydown',(event)=>{if((event.metaKey||event.ctrlKey)&&event.key==='Enter'){const inPanel=event.target instanceof HTMLElement&&event.target.closest('#pi-plan-review-root');const inComposer=event.target instanceof HTMLElement&&(event.target.closest('.pi-inline-composer')||event.target.closest('.pi-global-composer'));if(inPanel&&!inComposer){event.preventDefault();submitReview();}}});
function getActiveSelectionInfo(){const sel=window.getSelection&&window.getSelection();if(!sel||sel.isCollapsed||sel.rangeCount===0)return null;const range=sel.getRangeAt(0);const text=sel.toString().replace(/\s+/g,' ').trim();if(!text)return null;const node=range.commonAncestorContainer;const el=node&&node.nodeType===1?node:node&&node.parentElement;if(!el)return null;if(el.closest('#pi-plan-review-root')||el.closest('.pi-inline-composer')||el.closest('.pi-global-composer')||el.closest('.pi-selection-popover'))return null;const block=el.closest('[data-review-id]');if(!block)return null;return {range:range,text:text,block:block};}
function hideSelectionPopover(){if(state.selectionPopover){state.selectionPopover.remove();state.selectionPopover=null;}}
function showSelectionPopover(info){hideSelectionPopover();const rect=info.range.getBoundingClientRect();if(!rect||(rect.width===0&&rect.height===0))return;const el=document.createElement('button');el.type='button';el.className='pi-selection-popover';el.textContent='💬 Comment on selection';el.style.top=Math.min(window.innerHeight-44,rect.bottom+8)+'px';el.style.left=Math.max(12,Math.min(window.innerWidth-260,rect.left))+'px';el.addEventListener('mousedown',(e)=>e.preventDefault());el.addEventListener('click',(e)=>{e.preventDefault();e.stopPropagation();commentOnSelection(info);hideSelectionPopover();});document.body.appendChild(el);state.selectionPopover=el;}
function isSimpleTextSelection(range){if(range.startContainer!==range.endContainer)return false;return range.startContainer&&range.startContainer.nodeType===Node.TEXT_NODE;}
function wrapSelectionWithMark(range,id){if(!isSimpleTextSelection(range))return null;const mark=document.createElement('mark');mark.className='pi-review-mark';mark.dataset.annotationId=id;try{range.surroundContents(mark);return mark;}catch(e){return null;}}
function commentOnSelection(info){const id=crypto.randomUUID();const mark=wrapSelectionWithMark(info.range,id);try{window.getSelection().removeAllRanges();}catch(e){}state.pendingSnippet=info.text.slice(0,240);state.pendingMarkId=mark?id:null;state.pendingAnnotationId=mark?id:crypto.randomUUID();openComposer(info.block,null,{title:info.block.dataset.reviewTitle||info.block.dataset.reviewId||'Selection',snippet:info.text});}
function refreshSelectionPopover(){const info=getActiveSelectionInfo();if(!info){hideSelectionPopover();return;}hideSelectionPopover();commentOnSelection(info);}
document.addEventListener('mouseup',()=>setTimeout(refreshSelectionPopover,0));
document.addEventListener('keyup',(event)=>{if(event.shiftKey||event.key==='ArrowLeft'||event.key==='ArrowRight'||event.key==='ArrowUp'||event.key==='ArrowDown')refreshSelectionPopover();});
document.addEventListener('mousedown',(event)=>{const t=event.target;if(t instanceof HTMLElement&&t.closest('.pi-selection-popover'))return;hideSelectionPopover();});
document.addEventListener('click',(event)=>{const t=event.target instanceof HTMLElement?event.target:null;if(!t)return;const mark=t.closest('mark.pi-review-mark');if(!mark)return;const id=mark.dataset.annotationId;const annotation=state.annotations.find((a)=>a.id===id);if(!annotation)return;event.preventDefault();event.stopImmediatePropagation();state.pendingAnnotationId=annotation.id;state.pendingMarkId=annotation.markId;state.pendingSnippet=annotation.textSnippet;const block=mark.closest('[data-review-id]')||state.blocks[0];openComposer(block,annotation,{title:'Edit comment on selection'});},true);
document.addEventListener('mouseover',(event)=>{if(!state.reviewMode)return;const t=event.target instanceof HTMLElement?event.target:null;if(!t)return;if(t.closest('.pr-toc')||t.closest('a,button,summary,label,input,textarea,select,[data-no-review]')){clearHover();return;}const el=t.closest('[data-review-id]');if(!el||el.closest('#pi-plan-review-root'))return;clearHover();state.hovered=el;el.classList.add('pi-review-hover');},true);
document.addEventListener('click',(event)=>{if(!state.reviewMode)return;const node=event.target instanceof HTMLElement?event.target:null;if(!node)return;if(node.closest('#pi-plan-review-root'))return;if(node.closest('.pi-inline-composer')||node.closest('.pi-global-composer')||node.closest('.pi-selection-popover'))return;if(node.closest('a,button,summary,label,input,textarea,select,[data-no-review]'))return;if(node.closest('.pr-toc'))return;const sel=window.getSelection&&window.getSelection();if(sel&&!sel.isCollapsed&&sel.toString().trim().length>0)return;const block=node.closest('[data-review-id]');if(!block)return;state.lastClick={x:event.clientX,y:event.clientY};event.preventDefault();event.stopPropagation();clearHover();openComposer(block);},true);
state.blocks=gatherReviewBlocks();
renderAnnotations();
updateBadges();
syncReviewMeta();
syncReviewMeta();
})();`;
}

function injectReviewClient(html: string, config: { sourcePath: string }): string {
	const configScript = `<script>window.__PI_HTML_REVIEW__=${JSON.stringify(config)};</script>`;
	const sidebarMarkup = buildSidebarMarkup(config.sourcePath);
	const script = buildInjectedScript();
	const injected = `${configScript}
<style>
html,body{max-width:100vw;overflow-x:hidden!important}
body{padding-right:min(28vw,400px)!important;padding-bottom:0!important;box-sizing:border-box;}
[data-review-id]{min-width:0!important;overflow-wrap:anywhere;word-break:break-word}
[data-review-id] pre{max-width:100%;overflow:auto}
#pi-plan-review-root *{box-sizing:border-box;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
#pi-plan-review-root{position:fixed;top:0;right:0;bottom:0;width:min(28vw,400px);min-width:340px;z-index:2147483647;color:#ecf2f8}
#pi-plan-review-panel{height:100%;display:flex;flex-direction:column;background:linear-gradient(180deg,#162132,#0f172a);border-left:1px solid rgba(103,210,231,.14);min-height:0}
#pi-plan-review-header{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid rgba(103,210,231,.10);flex-shrink:0}
.pi-review-filename{flex:1;min-width:0;color:#e6edf5;font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#pi-plan-review-comments{flex:1;min-height:0;overflow:auto;padding:8px 14px}
#pi-plan-review-footer{flex-shrink:0;display:flex;flex-direction:column;gap:8px;padding:12px 14px 14px;border-top:1px solid rgba(103,210,231,.14);background:rgba(9,14,24,.45);box-shadow:0 -8px 24px rgba(2,8,23,.35)}
.pi-review-footer-actions{display:flex;gap:8px;justify-content:flex-end;align-items:center}
#pi-plan-review-root button{border:1px solid rgba(148,163,184,.24);background:rgba(255,255,255,.04);color:#d7e0ea;border-radius:10px;padding:8px 12px;font-size:12px;font-weight:600;cursor:pointer;transition:border-color .15s ease,color .15s ease,background .15s ease}
#pi-plan-review-root button:hover{border-color:rgba(103,210,231,.45);color:#ecf2f8}
#pi-plan-review-root button:disabled{opacity:.45;cursor:not-allowed}
#pi-plan-review-root button[data-kind="primary"]{background:#0f766e;border-color:#0f766e;color:#fff}
#pi-plan-review-root button[data-kind="primary"]:hover{background:#115e59;border-color:#115e59}
#pi-plan-review-root button.pi-review-ghost{border:none!important;background:none!important;color:#8ea0b8;padding:6px 8px!important;font-size:11px!important;font-weight:600!important}
#pi-plan-review-root button.pi-review-ghost:hover{color:#67d2e7;background:rgba(103,210,231,.06)!important}
#pi-plan-review-status{display:none;padding:8px 10px;border-radius:8px;font-size:12px;line-height:1.4}
#pi-plan-review-status[data-visible="true"]{display:block}
#pi-plan-review-status[data-kind="info"]{background:rgba(103,210,231,.08);color:#8ea0b8}
#pi-plan-review-status[data-kind="success"]{background:rgba(15,118,110,.18);color:#5eead4}
#pi-plan-review-status[data-kind="error"]{background:rgba(190,18,60,.18);color:#fda4af}
.pi-review-label{font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#8ea0b8;margin-bottom:-2px}
.pi-review-textarea{width:100%;min-height:64px;padding:10px 12px;border:1px solid rgba(103,210,231,.22);border-radius:10px;background:rgba(9,14,24,.72);color:#ecf2f8;font-size:13px;line-height:1.5;resize:vertical;transition:border-color .15s ease,box-shadow .15s ease,min-height .15s ease}
.pi-review-textarea::placeholder{color:#64748b}
.pi-review-textarea:focus{outline:none;border-color:#67d2e7;box-shadow:0 0 0 3px rgba(103,210,231,.14);min-height:120px}
.pi-review-summary{min-height:64px}
.pi-review-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:32px 16px;color:#64748b;font-size:13px;text-align:center;line-height:1.5}
.pi-review-empty-icon{width:32px;height:32px;border-radius:999px;border:1px dashed rgba(103,210,231,.28);display:flex;align-items:center;justify-content:center;color:#67d2e7;font-size:18px;line-height:1}
.pi-review-annotations{display:flex;flex-direction:column;gap:8px;padding:8px 0}
.pi-comment-card{position:relative;padding:10px 12px 10px 14px;border-radius:10px;background:rgba(255,255,255,.025);border:1px solid rgba(103,210,231,.08);border-left:3px solid #67d2e7;transition:background .15s ease,border-color .15s ease}
.pi-comment-card:hover{background:rgba(255,255,255,.05);border-color:rgba(103,210,231,.22)}
.pi-comment-anchor{display:block;width:100%;text-align:left;padding:0!important;border:none!important;background:none!important;color:#67d2e7!important;font-size:11px!important;font-weight:600!important;letter-spacing:.02em;margin-bottom:4px}
.pi-comment-anchor:hover{color:#a5e8f3!important;background:none!important;border:none!important}
.pi-comment-body{margin:0;font-size:13px;line-height:1.5;color:#d7e0ea;word-break:break-word}
.pi-comment-actions{display:flex;gap:6px;justify-content:flex-end;margin-top:6px;opacity:0;transition:opacity .15s ease;pointer-events:none}
.pi-comment-card:hover .pi-comment-actions,.pi-comment-card:focus-within .pi-comment-actions,.pi-comment-card[data-recent="true"] .pi-comment-actions{opacity:1;pointer-events:auto}
.pi-review-edit,.pi-review-ask,.pi-review-remove{padding:4px 8px!important;border-radius:6px!important;font-size:11px!important;font-weight:600!important;background:rgba(255,255,255,.04)!important;border:1px solid rgba(148,163,184,.18)!important}
.pi-review-edit{color:#8ea0b8!important}
.pi-review-edit:hover{color:#ecf2f8!important;border-color:rgba(103,210,231,.35)!important}
.pi-review-ask{color:#67d2e7!important}
.pi-review-ask:hover{color:#a5e8f3!important;border-color:rgba(103,210,231,.45)!important;background:rgba(103,210,231,.08)!important}
.pi-review-remove{color:#fda4af!important}
.pi-review-remove:hover{color:#fff!important;background:rgba(190,18,60,.25)!important;border-color:rgba(253,164,175,.45)!important}
[data-review-id]{scroll-margin-top:32px;position:relative}
.pi-review-hover{outline:1px dashed rgba(103,210,231,.55)!important;outline-offset:4px!important}
.pi-review-selected{outline:2px solid rgba(15,118,110,.85)!important;outline-offset:4px!important}
.pi-review-badge{position:absolute;top:10px;right:10px;min-width:22px;height:22px;padding:0 6px;border-radius:999px;background:#0f766e;color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 18px rgba(15,118,110,.22)}
.pi-inline-composer{position:fixed;z-index:2147483000;width:320px;max-width:calc(100vw - 24px)}
.pi-inline-composer::before{content:'';position:absolute;width:16px;height:16px;background:#162132;border-left:1px solid rgba(103,210,231,.28);border-top:1px solid rgba(103,210,231,.28);transform:rotate(45deg);top:20px;left:-8px}
.pi-inline-composer[data-placement="left"]::before{left:auto;right:-8px;border-left:none;border-top:none;border-right:1px solid rgba(103,210,231,.28);border-bottom:1px solid rgba(103,210,231,.28)}
.pi-inline-composer[data-placement="bottom"]::before{top:-8px;left:26px}
.pi-inline-composer[data-placement="top"]::before{top:auto;bottom:-8px;left:26px;border-left:none;border-top:none;border-right:1px solid rgba(103,210,231,.28);border-bottom:1px solid rgba(103,210,231,.28)}
.pi-global-composer{position:fixed;left:24px;bottom:24px;z-index:2147483001;width:min(420px,calc(100vw - 48px))}
.pi-inline-composer-card,.pi-inline-composer-card *{box-sizing:border-box}
.pi-inline-composer-card{border:1px solid rgba(103,210,231,.22);border-radius:16px;background:linear-gradient(180deg,rgba(18,26,39,.98),rgba(15,23,42,.98));box-shadow:0 22px 46px rgba(2,8,23,.42);padding:14px;color:#ecf2f8}
.pi-inline-composer-header{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:10px}
.pi-inline-composer-header strong{font-size:13px;line-height:1.4;color:#e6edf5}
.pi-inline-close{padding:0!important;border:none!important;background:none!important;font-size:20px!important;line-height:1!important;color:#8ea0b8!important}
.pi-inline-textarea{width:100%;min-height:110px;padding:12px;border:1px solid rgba(103,210,231,.32);border-radius:12px;background:rgba(9,14,24,.72);color:#ecf2f8;font-size:13px;resize:vertical}
.pi-inline-textarea::placeholder{color:#8ea0b8}
.pi-inline-textarea:focus{outline:none;border-color:#67d2e7;box-shadow:0 0 0 3px rgba(103,210,231,.14)}
.pi-inline-composer.pi-composer-chatting .pi-inline-textarea{min-height:48px;max-height:96px;padding:8px 10px;line-height:1.35;resize:none}
.pi-inline-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:10px}
.pi-inline-buttons{display:flex;gap:8px;align-items:center}
.pi-inline-composer .pi-inline-save,.pi-global-composer .pi-inline-save{background:#0f766e!important;border-color:#0f766e!important;color:#fff!important;border-radius:10px!important;padding:8px 14px!important;font-weight:600!important}
.pi-inline-composer .pi-inline-save:hover,.pi-global-composer .pi-inline-save:hover{background:#115e59!important;border-color:#115e59!important}
.pi-inline-composer .pi-inline-ask{background:rgba(103,210,231,.08)!important;border-color:rgba(103,210,231,.28)!important;color:#a5e8f3!important;border-radius:10px!important;padding:8px 12px!important;font-weight:600!important}
.pi-inline-composer .pi-inline-ask:hover{background:rgba(103,210,231,.14)!important;border-color:rgba(103,210,231,.45)!important;color:#ecf2f8!important}
.pi-inline-actions{display:flex;gap:12px;justify-content:space-between;align-items:center;margin-top:10px}
.pi-inline-hint{font-size:11px;color:#8ea0b8}
.pi-composer-thread{display:flex;flex-direction:column;gap:7px;margin-top:10px;max-height:180px;overflow:auto}
.pi-composer-thread:empty{display:none}
#pi-submitted-overlay{position:fixed;inset:0;z-index:2147483646;background:rgba(11,18,32,.92);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:24px;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#ecf2f8}
.pi-submitted-card{max-width:420px;width:100%;text-align:center;padding:32px 28px;border-radius:20px;border:1px solid rgba(103,210,231,.24);background:linear-gradient(180deg,#162132,#0f172a);box-shadow:0 32px 80px rgba(2,8,23,.55)}
.pi-submitted-check{width:56px;height:56px;border-radius:999px;background:rgba(15,118,110,.18);color:#5eead4;font-size:28px;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;border:1px solid rgba(94,234,212,.32)}
.pi-submitted-card h2{margin:0 0 6px;font-size:22px;font-weight:650;letter-spacing:-.01em}
.pi-submitted-card p{margin:0 0 4px;color:#8ea0b8;font-size:13px;line-height:1.5}
.pi-submitted-hint{font-size:12px!important;color:#64748b!important;margin-top:8px!important}
#pi-submitted-close{margin-top:18px;padding:9px 18px;border-radius:10px;border:1px solid #0f766e;background:#0f766e;color:#fff;font-size:13px;font-weight:600;cursor:pointer}
#pi-submitted-close:hover{background:#115e59;border-color:#115e59}
mark.pi-review-mark{background:rgba(250,204,21,.28);color:inherit;border-radius:3px;padding:1px 2px;box-shadow:inset 0 -2px 0 rgba(250,204,21,.85);cursor:pointer;transition:background .15s ease,box-shadow .15s ease}
mark.pi-review-mark:hover{background:rgba(250,204,21,.45);box-shadow:inset 0 -2px 0 #facc15}
.pi-inline-snippet{margin:0 0 10px;padding:8px 10px;border-left:3px solid rgba(250,204,21,.85);background:rgba(250,204,21,.10);border-radius:6px;color:#dbe3ef;font-size:12px;line-height:1.45;font-style:italic;max-height:88px;overflow:auto;white-space:pre-wrap;word-break:break-word}
@keyframes pi-mark-pulse{0%{background:rgba(103,210,231,.55);box-shadow:inset 0 -2px 0 #67d2e7,0 0 0 4px rgba(103,210,231,.18)}100%{background:rgba(103,210,231,.18);box-shadow:inset 0 -2px 0 rgba(103,210,231,.55)}}
mark.pi-review-mark-pulse{animation:pi-mark-pulse 1.2s ease}
.pi-selection-popover{position:fixed;z-index:2147483002;display:inline-flex;align-items:center;gap:6px;padding:8px 12px;border-radius:12px;border:1px solid rgba(103,210,231,.22);background:linear-gradient(180deg,rgba(18,26,39,.98),rgba(15,23,42,.98));color:#ecf2f8;font-size:12px;font-weight:600;letter-spacing:.01em;cursor:pointer;box-shadow:0 18px 38px rgba(2,8,23,.42);font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;transition:border-color .15s ease,color .15s ease,box-shadow .15s ease}
.pi-selection-popover:hover{border-color:rgba(103,210,231,.45);color:#67d2e7;box-shadow:0 22px 46px rgba(2,8,23,.5)}
.pi-comment-snippet{margin:0 0 6px;padding:6px 8px;border-left:2px solid rgba(103,210,231,.4);background:rgba(103,210,231,.06);font-size:12px;color:#a5e8f3;font-style:italic;word-break:break-word;border-radius:0 6px 6px 0}
.pi-qa-thread{display:none;margin-top:10px;padding-top:10px;border-top:1px solid rgba(103,210,231,.10);gap:7px;flex-direction:column}
.pi-comment-card.pi-qa-open .pi-qa-thread{display:flex}
.pi-qa-bubble{padding:8px 10px;border-radius:10px;font-size:12px;line-height:1.45;word-break:break-word;white-space:pre-wrap}
.pi-qa-user{align-self:flex-end;max-width:92%;background:rgba(103,210,231,.12);color:#dff8fc;border:1px solid rgba(103,210,231,.16)}
.pi-qa-assistant{align-self:flex-start;max-width:96%;background:rgba(255,255,255,.045);color:#d7e0ea;border:1px solid rgba(148,163,184,.14)}
.pi-qa-assistant[data-error="true"]{background:rgba(190,18,60,.14);border-color:rgba(253,164,175,.24);color:#fda4af}
.pi-qa-form{display:flex;gap:6px;align-items:flex-end;margin-top:2px}
.pi-qa-input{flex:1;min-height:38px;max-height:110px;padding:8px 9px;border:1px solid rgba(103,210,231,.20);border-radius:9px;background:rgba(9,14,24,.62);color:#ecf2f8;font-size:12px;line-height:1.4;resize:vertical}
.pi-qa-input::placeholder{color:#64748b}
.pi-qa-input:focus{outline:none;border-color:#67d2e7;box-shadow:0 0 0 2px rgba(103,210,231,.12)}
.pi-qa-send{flex:0 0 auto;background:#0f766e!important;border-color:#0f766e!important;color:#fff!important;padding:8px 10px!important;border-radius:9px!important}
@media (max-width: 960px){body{padding-right:0!important;padding-bottom:48vh!important}#pi-plan-review-root{left:0;right:0;top:auto;width:100vw;min-width:0;height:48vh}#pi-plan-review-footer{padding:10px 12px 12px}.pi-inline-composer{left:12px!important;right:12px!important;top:auto!important;bottom:12px!important;width:auto!important}.pi-inline-composer.pi-composer-chatting .pi-inline-textarea{min-height:44px;max-height:84px}.pi-inline-composer::before{display:none}.pi-global-composer{left:12px;right:12px;bottom:12px;width:auto}}
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

	async function launchReview(sourcePathInput: string, ctx: any) {
		const sourcePath = path.resolve(ctx.cwd, sourcePathInput);
		const sourceHtml = await fs.readFile(sourcePath, "utf8");
		const slug = slugify(path.basename(sourcePath, path.extname(sourcePath)));
		const reviewDir = path.join(ctx.cwd, REVIEW_ROOT, slug);
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

				if (req.method === "POST" && req.url === "/api/ask") {
					const chunks: Buffer[] = [];
					for await (const chunk of req) {
						chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
					}
					const payload = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
					const answer = await answerReviewQuestion(ctx, sourceHtml, payload);
					res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
					res.end(JSON.stringify({ ok: true, answer }));
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
					setTimeout(() => { closeServer().catch(() => {}); }, 750);
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
			const result = await launchReview(fileArg, ctx);
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
			const result = await launchReview(params.path, ctx);
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
