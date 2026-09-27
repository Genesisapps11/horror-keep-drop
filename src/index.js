const PICKS_KEY = "picks";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function cleanPicks(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (entries.length > 200) return null;
  const picks = {};
  for (const [id, choice] of entries) {
    if (!/^[a-z0-9-]{1,64}$/.test(id)) return null;
    if (choice !== "keep" && choice !== "drop") return null;
    picks[id] = choice;
  }
  return picks;
}

function sameSecret(given, expected) {
  if (!expected || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

function allowed(request, env) {
  const header = request.headers.get("authorization") || "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : "";
  return sameSecret(given, env.PICKS_CODE || "");
}

async function handlePicks(request, env) {
  if (!allowed(request, env)) return json({ error: "unauthorized" }, 401);

  if (request.method === "GET" || request.method === "HEAD") {
    const raw = await env.PICKS.get(PICKS_KEY);
    const stored = raw ? JSON.parse(raw) : { updated: null, picks: {} };
    if (request.method === "HEAD") {
      return new Response(null, { status: 200, headers: { "cache-control": "no-store" } });
    }
    return json(stored);
  }

  if (request.method === "PUT") {
    const text = await request.text();
    if (text.length > 20000) return json({ error: "too large" }, 413);
    let body;
    try {
      body = JSON.parse(text);
    } catch (error) {
      return json({ error: "bad json" }, 400);
    }
    const picks = cleanPicks(body && body.picks);
    if (!picks) return json({ error: "bad picks" }, 400);
    const stored = { updated: new Date().toISOString(), picks };
    await env.PICKS.put(PICKS_KEY, JSON.stringify(stored));
    return json(stored);
  }

  return new Response("Method not allowed", {
    status: 405,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

async function handleSend(request, env) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  if (!allowed(request, env)) return json({ error: "unauthorized" }, 401);

  const raw = await request.text();
  if (raw.length > 100000) return json({ error: "too large" }, 413);
  let body;
  try {
    body = JSON.parse(raw);
  } catch (error) {
    return json({ error: "bad json" }, 400);
  }
  const picks = cleanPicks(body && body.picks);
  if (!picks) return json({ error: "bad picks" }, 400);
  const text = typeof body.text === "string" ? body.text : "";
  const topic = env.NTFY_TOPIC || "";
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(topic)) return json({ error: "webhook not configured" }, 500);

  const sent = { updated: new Date().toISOString(), picks, text };
  await env.PICKS.put("sent", JSON.stringify(sent));

  const webhook = await fetch("https://ntfy.sh/" + topic, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      Title: "Horror list",
      Click: "https://horror-keep-drop.automatedtradingmachine.workers.dev/",
    },
    body: text || "No titles marked.",
  });
  if (!webhook.ok) return json({ error: "webhook failed", status: webhook.status }, 502);
  return json({ ok: true, updated: sent.updated });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/picks") return handlePicks(request, env);
    if (url.pathname === "/send") return handleSend(request, env);

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", {
        status: 405,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    if (url.pathname !== "/" && url.pathname !== "/index.html") {
      return new Response("Not found", {
        status: 404,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    const assetUrl = new URL("/", url);
    return env.ASSETS.fetch(new Request(assetUrl, request));
  },
};
