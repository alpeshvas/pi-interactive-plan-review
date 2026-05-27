import { createServer } from "node:http";
import { readJsonBody, sendJson } from "./http-utils";
import { answerReviewQuestion } from "./review-question-answering";
import { renderHtmlWithReviewSurface } from "./review-page";
import { annotationCount, saveSubmission } from "./review-submissions";

const REVIEW_HOST = "127.0.0.1";

export type ReviewServerOptions = {
	ctx: any;
	sourceHtml: string;
	sourcePath: string;
	reviewDir: string;
	submissionsDir: string;
	onSubmitted?: (payload: any, savedPaths: { jsonPath: string; markdownPath: string }) => void;
	onShouldClose?: () => void;
};

function htmlResponse(res: import("node:http").ServerResponse, html: string) {
	res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
	res.end(html);
}

function isDocumentRequest(req: import("node:http").IncomingMessage): boolean {
	return req.method === "GET" && (req.url === "/" || req.url === "");
}

export function createReviewServer(options: ReviewServerOptions) {
	return createServer(async (req, res) => {
		try {
			if (isDocumentRequest(req)) {
				htmlResponse(res, renderHtmlWithReviewSurface(options.sourceHtml, { sourcePath: options.sourcePath }));
				return;
			}

			if (req.method === "POST" && req.url === "/api/ask") {
				const payload = await readJsonBody(req);
				const answer = await answerReviewQuestion(options.ctx, options.sourceHtml, payload);
				sendJson(res, 200, { ok: true, answer });
				return;
			}

			if (req.method === "POST" && req.url === "/api/submit") {
				const payload = await readJsonBody(req);
				const savedPaths = await saveSubmission(payload, options.reviewDir, options.submissionsDir);
				options.onSubmitted?.(payload, savedPaths);

				sendJson(res, 200, { ok: true, annotationCount: annotationCount(payload), ...savedPaths });
				options.onShouldClose?.();
				return;
			}

			sendJson(res, 404, { error: "Not found" });
		} catch (error: any) {
			if (!res.headersSent) {
				sendJson(res, 500, { error: error?.message ?? "Unknown error" });
			}
		}
	});
}

export async function listenOnRandomPort(server: import("node:http").Server): Promise<number> {
	return new Promise<number>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, REVIEW_HOST, () => {
			const address = server.address();
			if (!address || typeof address === "string") {
				reject(new Error("Could not determine review server port"));
				return;
			}
			resolve(address.port);
		});
	});
}

export function reviewUrl(port: number): string {
	return `http://${REVIEW_HOST}:${port}`;
}
