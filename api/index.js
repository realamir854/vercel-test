export const setup = { runtime: "edge" };

const BACKEND_ROOT = (process.env.REMOTE_HOST || "").replace(/\/$/, "");

const FILTERED_HEADERS = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "forwarded",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-port",
]);

export default async function gateway(request) {
  if (!BACKEND_ROOT) {
    return new Response("Config Error: REMOTE_HOST missing", { status: 500 });
  }

  try {
    const slashIndex = request.url.indexOf("/", 8);
    const destination =
      slashIndex === -1 ? BACKEND_ROOT + "/" : BACKEND_ROOT + request.url.slice(slashIndex);

    const headersForward = new Headers();
    let realClientIp = null;
    for (const [key, val] of request.headers) {
      if (FILTERED_HEADERS.has(key)) continue;
      if (key.startsWith("x-vercel-")) continue;
      if (key === "x-real-ip") {
        realClientIp = val;
        continue;
      }
      if (key === "x-forwarded-for") {
        if (!realClientIp) realClientIp = val;
        continue;
      }
      headersForward.set(key, val);
    }
    if (realClientIp) headersForward.set("x-forwarded-for", realClientIp);

    const httpMethod = request.method;
    const allowBody = httpMethod !== "GET" && httpMethod !== "HEAD";

    return await fetch(destination, {
      method: httpMethod,
      headers: headersForward,
      body: allowBody ? request.body : undefined,
      duplex: "half",
      redirect: "manual",
    });
  } catch (err) {
    console.error("proxy tunnel error:", err);
    return new Response("Failed to reach backend", { status: 502 });
  }
}
