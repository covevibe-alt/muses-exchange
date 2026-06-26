// GitHub OAuth — step 2 of 2. GitHub redirects here with ?code=…; we exchange
// it for an access token and hand it back to the CMS window using the
// Decap/Sveltia postMessage handshake. Pairs with auth.mjs.

export default async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;

  if (!code) return new Response("Missing ?code", { status: 400 });
  if (!clientId || !clientSecret) {
    return new Response("Missing GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET", { status: 500 });
  }

  let token, error;
  try {
    const r = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
    });
    const data = await r.json();
    token = data.access_token;
    error = data.error;
  } catch (e) {
    error = String(e);
  }

  const message = token
    ? "authorization:github:success:" + JSON.stringify({ token, provider: "github" })
    : "authorization:github:error:" + JSON.stringify({ error: error || "no_token" });

  // The CMS opens this in a popup, posts "authorizing:github" to us, then we
  // reply with the success/error payload, scoped to the opener's origin.
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Signing in…</title></head>
<body style="font-family:system-ui;background:#0b0910;color:#f7f3ea;display:grid;place-items:center;height:100vh;margin:0">
<p>Completing sign-in…</p>
<script>
  (function () {
    var message = ${JSON.stringify(message)};
    function receive(e) {
      if (!window.opener) return;
      window.opener.postMessage(message, e.origin);
      window.removeEventListener("message", receive, false);
    }
    window.addEventListener("message", receive, false);
    if (window.opener) {
      window.opener.postMessage("authorizing:github", "*");
    } else {
      document.body.innerHTML = "<p>Sign-in complete. You can close this window.</p>";
    }
  })();
</script>
</body></html>`;

  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
};
