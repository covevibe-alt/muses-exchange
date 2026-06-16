// GitHub OAuth — step 1 of 2. Redirects the CMS popup to GitHub's authorize
// screen. Pairs with callback.mjs. Used by Sveltia/Decap CMS (admin/config.yml
// backend.base_url = https://muses.exchange, auth_endpoint = this function).
//
// Required Netlify env vars (Site settings → Environment variables):
//   GITHUB_CLIENT_ID       OAuth app client id
//   GITHUB_CLIENT_SECRET   OAuth app client secret  (used in callback.mjs)
//
// The GitHub OAuth app's "Authorization callback URL" must be:
//   https://muses.exchange/.netlify/functions/callback

export default async (req) => {
  const url = new URL(req.url);
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) {
    return new Response("Missing GITHUB_CLIENT_ID env var", { status: 500 });
  }
  // Public repo only needs public_repo, but `repo` works for public + private.
  const scope = url.searchParams.get("scope") || "repo";
  const redirectUri = `${url.origin}/.netlify/functions/callback`;
  const state = (globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2));

  const authorize = new URL("https://github.com/login/oauth/authorize");
  authorize.searchParams.set("client_id", clientId);
  authorize.searchParams.set("redirect_uri", redirectUri);
  authorize.searchParams.set("scope", scope);
  authorize.searchParams.set("state", state);

  return new Response(null, {
    status: 302,
    headers: { Location: authorize.toString() },
  });
};
