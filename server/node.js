// @ts-check
// Nối lớp API (server/app.js) vào một máy chủ HTTP của Node: dùng khi chạy ở máy mình (vite.config.ts gắn vào /api) và
// trong các bài kiểm thử. Trên Vercel không dùng file này (xem api/index.js).
import { createServer } from "node:http";
import { MAX_BODY_BYTES, RESPONSE_HEADERS, handle } from "./app.js";

/**
 * @param {import("node:http").IncomingMessage} req
 * @returns {Promise<string>}
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = [];
    let size = 0;
    let over = false;
    req.on("data", (chunk) => {
      size += chunk.length;
      // Quá lớn: thôi không giữ nữa (vẫn đọc cho hết để còn trả lời được 413).
      if (size > MAX_BODY_BYTES) over = true;
      else chunks.push(chunk);
    });
    req.on("end", () => resolve(over ? " ".repeat(MAX_BODY_BYTES + 1) : Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/**
 * Trả lời một yêu cầu HTTP của Node bằng lớp API.
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 */
export async function handleNode(req, res) {
  try {
    const header = (/** @type {string} */ name) => {
      const value = req.headers[name];
      return Array.isArray(value) ? value[0] ?? "" : value ?? "";
    };
    const method = req.method ?? "GET";
    const { status, body } = await handle({
      method,
      contentType: header("content-type"),
      authorization: header("authorization"),
      body: method === "POST" ? await readBody(req) : "",
      ip: req.socket.remoteAddress ?? "",
    });
    res.writeHead(status, RESPONSE_HEADERS);
    res.end(method === "HEAD" ? undefined : JSON.stringify(body));
  } catch (error) {
    console.error("[km-api] không trả lời được:", error);
    if (!res.headersSent) res.writeHead(500, RESPONSE_HEADERS);
    res.end(JSON.stringify({ error: { code: "server", message: "Có lỗi trên máy chủ. Hãy thử lại." } }));
  }
}

/**
 * Mở một máy chủ HTTP chỉ có lớp API tại /api (mọi đường dẫn khác trả 404). Dùng trong kiểm thử.
 * @param {number} [port] 0 = hệ điều hành tự chọn cổng trống
 * @returns {Promise<{ url: string, close(): Promise<void> }>}
 */
export function startApiServer(port = 0) {
  const server = createServer((req, res) => {
    const path = (req.url ?? "").split("?")[0];
    if (path === "/api" || path === "/api/") void handleNode(req, res);
    else res.writeHead(404, RESPONSE_HEADERS).end(JSON.stringify({ error: { code: "not_found", message: "Không có gì ở đây." } }));
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      const actual = typeof address === "object" && address ? address.port : port;
      resolve({
        url: `http://127.0.0.1:${actual}/api`,
        close: () =>
          new Promise((done) => {
            server.closeAllConnections?.();
            server.close(() => done());
          }),
      });
    });
  });
}
