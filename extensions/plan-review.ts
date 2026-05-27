// @ts-nocheck
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { slugify } from "./review-page";
import { createReviewServer, listenOnRandomPort, reviewUrl } from "./review-server";
import { buildReviewSummary } from "./review-submissions";

const execFileAsync = promisify(execFile);
const REVIEW_ROOT = ".pi/html-reviews";
const SERVER_SHUTDOWN_DELAY_MS = 750;

type ReviewRuntime = {
	server?: import("node:http").Server;
	port?: number;
	sourcePath?: string;
	reviewDir?: string;
};

type ReviewLaunchResult = {
	url: string;
	reviewDir: string;
	sourcePath: string;
};

async function openBrowser(url: string) {
	const commands = process.platform === "darwin" ? [["open", [url]]] : [["xdg-open", [url]]];
	for (const [command, args] of commands) {
		try {
			await execFileAsync(command, args);
			return;
		} catch {}
	}
}

export default function (pi: ExtensionAPI) {
	const runtime: ReviewRuntime = {};

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

	function scheduleServerShutdown() {
		setTimeout(() => { closeServer().catch(() => {}); }, SERVER_SHUTDOWN_DELAY_MS);
	}

	function forwardSubmissionToPi(payload: any, savedPaths: { jsonPath: string; markdownPath: string }) {
		try {
			pi.sendUserMessage(buildReviewSummary(payload, savedPaths.jsonPath, savedPaths.markdownPath), { deliverAs: "followUp" });
		} catch {}
	}

	async function launchReview(sourcePathInput: string, ctx: any): Promise<ReviewLaunchResult> {
		const sourcePath = path.resolve(ctx.cwd, sourcePathInput);
		const sourceHtml = await fs.readFile(sourcePath, "utf8");
		const slug = slugify(path.basename(sourcePath, path.extname(sourcePath)));
		const reviewDir = path.join(ctx.cwd, REVIEW_ROOT, slug);
		const submissionsDir = path.join(reviewDir, "submissions");
		await fs.mkdir(submissionsDir, { recursive: true });

		await closeServer();

		const server = createReviewServer({
			ctx,
			sourceHtml,
			sourcePath,
			reviewDir,
			submissionsDir,
			onSubmitted: forwardSubmissionToPi,
			onShouldClose: scheduleServerShutdown,
		});
		const port = await listenOnRandomPort(server);
		Object.assign(runtime, { server, port, sourcePath, reviewDir });

		const url = reviewUrl(port);
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
			ctx.ui.notify(`Opened pi-human-inquire: ${result.url}`, "info");
			ctx.ui.notify(`Review files will be saved in ${result.reviewDir}`, "info");
		} catch (error: any) {
			ctx.ui.notify(`Failed to open HTML review: ${error?.message ?? error}`, "error");
		}
	};

	pi.registerCommand("annotate-html", {
		description: "Open reviewable HTML in pi-human-inquire with questions, comments, and submission",
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
		description: "Open reviewable HTML in pi-human-inquire with inline questions and feedback support",
		promptSnippet: "Open reviewable HTML for in-page questions, threaded discussion, and feedback.",
		promptGuidelines: ["Use open_html_review when the user wants to open reviewable HTML for in-page questions, threaded discussion, comments, and feedback submission."],
		parameters: Type.Object({
			path: Type.String({ description: "Path to the HTML file to open in pi-human-inquire" }),
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
