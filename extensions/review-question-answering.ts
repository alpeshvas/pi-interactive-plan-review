import { complete } from "@earendil-works/pi-ai";

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

function buildQuestionPrompt(ctx: any, sourceHtml: string, payload: any): string {
	const conversation = Array.isArray(payload?.conversation) ? payload.conversation : [];
	const annotations = Array.isArray(payload?.annotations) ? payload.annotations : [];
	return [
		"Current Pi session context:",
		recentSessionContext(ctx) || "(none)",
		"",
		"HTML document text:",
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
		String(payload?.question || "").trim(),
	].join("\n");
}

export async function answerReviewQuestion(ctx: any, sourceHtml: string, payload: any): Promise<string> {
	if (!ctx.model) throw new Error("No model selected in Pi");
	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
	if (!auth.ok || !auth.apiKey) throw new Error(auth.ok ? `No API key for ${ctx.model.provider}` : auth.error);

	const question = String(payload?.question || "").trim();
	if (!question) throw new Error("Question is required");

	const response = await complete(
		ctx.model,
		{
			systemPrompt: "You are Pi helping with interactive in-page inquiry and review for an HTML document. Answer the user's question briefly and concretely using the current Pi session context, selected block, and existing comments. Do not modify files. If the context is insufficient, say what is missing. Keep the answer under 120 words unless the user asks for more.",
			messages: [{ role: "user", content: [{ type: "text", text: buildQuestionPrompt(ctx, sourceHtml, payload) }], timestamp: Date.now() }],
		},
		{ apiKey: auth.apiKey, headers: auth.headers, signal: ctx.signal },
	);

	return response.content
		.filter((part: any) => part?.type === "text" && typeof part.text === "string")
		.map((part: any) => part.text)
		.join("\n")
		.trim() || "I couldn't produce an answer.";
}
