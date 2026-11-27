import type { IncomingMessage, ServerResponse } from "node:http";

const json = (value: unknown): string => JSON.stringify(value);

const send = (
  res: ServerResponse,
  status: number,
  body: string | Buffer,
  headers: Record<string, string>,
): void => {
  res.writeHead(status, { "Content-Length": Buffer.byteLength(body), ...headers });
  res.end(body);
};

const sendJson = (
  res: ServerResponse,
  status: number,
  value: unknown,
  headers: Record<string, string> = {},
): void => {
  send(res, status, json(value), { "Content-Type": "application/json; charset=utf-8", ...headers });
};

const notModified = (res: ServerResponse, etag: string): void => {
  res.writeHead(304, { ETag: etag });
  res.end();
};

const ifNoneMatch = (req: IncomingMessage, etag: string): boolean => {
  const header = req.headers["if-none-match"];
  return header === etag || header === "*";
};

export { ifNoneMatch, json, notModified, send, sendJson };
