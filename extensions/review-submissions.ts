import { promises as fs } from "node:fs";
import path from "node:path";

export function annotationCount(payload: any): number {
	return Array.isArray(payload?.annotations) ? payload.annotations.length : 0;
}

export function buildReviewSummary(payload: any, jsonPath: string, markdownPath: string): string {
	const annotations = Array.isArray(payload?.annotations) ? payload.annotations : [];
	const lines = [
		`Feedback submitted for ${payload?.sourcePath ?? payload?.planFile ?? "unknown file"}.`,
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

function formatConversation(conversationInput: any): string[] {
	const conversation = Array.isArray(conversationInput) ? conversationInput : [];
	if (conversation.length === 0) return [];

	const lines = ["", "#### Inline Q&A", ""];
	for (const turn of conversation) {
		const role = turn?.role === "assistant" ? "Pi" : "Reviewer";
		lines.push(`**${role}:** ${turn?.text || ""}`, "");
	}
	return lines;
}

function toMarkdown(payload: any, jsonPath: string): string {
	const annotations = Array.isArray(payload?.annotations) ? payload.annotations : [];
	const lines = [
		"# pi-human-inquire Submission",
		"",
		`- Source file: \`${payload?.sourcePath ?? payload?.planFile ?? "unknown"}\``,
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
		lines.push("", annotation.comment || "(empty)", "");
		if (annotation.targetId) lines.push(`- Target id: \`${annotation.targetId}\``);
		if (annotation.selector) lines.push(`- Selector: \`${annotation.selector}\``);
		if (annotation.textSnippet) lines.push(`- Snippet: ${annotation.textSnippet}`);
		if (annotation.createdAt) lines.push(`- Captured at: ${annotation.createdAt}`);
		lines.push(...formatConversation(annotation.conversation), "");
	}

	return lines.join("\n");
}

export async function saveSubmission(payload: any, reviewDir: string, submissionsDir: string) {
	const submittedAt = payload?.submittedAt || new Date().toISOString();
	const stamp = submittedAt.replaceAll(/[:.]/g, "-");
	const jsonPath = path.join(submissionsDir, `${stamp}.json`);
	const markdownPath = path.join(submissionsDir, `${stamp}.md`);
	const json = JSON.stringify(payload, null, 2);

	await fs.writeFile(jsonPath, json);
	await fs.writeFile(markdownPath, toMarkdown(payload, jsonPath));
	await fs.writeFile(path.join(reviewDir, "latest.json"), json);
	await fs.writeFile(path.join(reviewDir, "latest.md"), toMarkdown(payload, jsonPath));

	return { jsonPath, markdownPath };
}
