// A small local service so a program in any language can ask for a decision or a comparison.
// It listens on this computer only, reads no files and keeps nothing between requests.
import {createServer} from "node:http";
import {readFileSync} from "node:fs";
import {compareContracts, decide} from "./evidence-source.mjs";
import {readJSON} from "./exact-json.mjs";

const LIMIT = 1048576;
const version = JSON.parse(readFileSync(new URL("package.json", import.meta.url), "utf8")).version;

function answer(path, body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw Error("Send one JSON object.");
  const fields = (allowed) => {
    const unknown = Object.keys(body).find(key => !allowed.includes(key));
    if (unknown !== undefined) throw Error("Unknown field: " + unknown + ". Use " + allowed.join(", ") + ".");
  };
  if (path === "/decide") {
    fields(["rules", "case", "explain"]);
    if (typeof body.rules !== "string") throw Error("Send the rule file text as rules.");
    if (body.explain !== undefined && typeof body.explain !== "boolean") throw Error("Send explain as true or false.");
    return decide(body.rules, body.case, {explain: body.explain === true});
  }
  fields(["old", "new"]);
  if (typeof body.old !== "string" || typeof body.new !== "string") throw Error("Send both rule file texts as old and new.");
  const {result, bindings} = compareContracts(body.old, body.new);
  return {status: result.changes.length || bindings.length ? "review" : "preserved", changes: result.changes, bindings};
}

export function serve(port = 8787) {
  const server = createServer((request, response) => {
    const send = (code, value) => {
      const text = JSON.stringify(value);
      response.writeHead(code, {"content-type": "application/json", "content-length": Buffer.byteLength(text), "cache-control": "no-store"});
      response.end(text);
    };
    const refuse = (code, reason) => send(code, {status: "hold", reason});
    // A page in a browser must not be able to reach this service through another name.
    const host = String(request.headers.host ?? "").replace(/:\d+$/, "");
    if (!["127.0.0.1", "localhost", "[::1]"].includes(host)) return refuse(403, "Call this service as 127.0.0.1 or localhost.");
    const path = new URL(request.url, "http://127.0.0.1").pathname;
    if (request.method === "GET" && path === "/health") return send(200, {status: "ok", version});
    if (!["/decide", "/compare"].includes(path)) return refuse(404, "Use POST /decide, POST /compare or GET /health.");
    if (request.method !== "POST") return refuse(405, "Use POST for " + path + ".");
    if (!/^application\/json\b/i.test(request.headers["content-type"] ?? "")) return refuse(415, "Send content-type: application/json.");
    const parts = [];
    let size = 0, stopped = false;
    request.on("data", part => {
      if (stopped) return;
      size += part.length;
      if (size > LIMIT) { stopped = true; refuse(413, "Send at most 1 MB."); request.destroy(); }
      else parts.push(part);
    });
    request.on("end", () => {
      if (stopped) return;
      try {
        let body;
        try { body = readJSON(Buffer.concat(parts).toString("utf8")); }
        catch (error) { throw Error(error instanceof SyntaxError ? "The request is not valid JSON." : error instanceof RangeError ? "The request is nested too deeply." : error.message); }
        send(200, answer(path, body));
      } catch (error) {
        const internal = error instanceof TypeError || error instanceof RangeError || error instanceof ReferenceError;
        refuse(400, internal ? "The request does not have the expected fields." : error.message);
      }
    });
  });
  server.requestTimeout = 30000;
  return new Promise((resolve, reject) => {
    server.once("error", error => reject(Error(error.code === "EADDRINUSE" ? "Port " + port + " is in use. Choose another with --port." : error.message)));
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}
