# delete-account — Edge Function

GDPR Art. 17 self-service account deletion. Called from the exchange
client when the signed-in user taps **Settings → Account → Delete my
account** and types `DELETE` to confirm.

## Why this is a function (and not a client-side call)

The browser uses the Supabase **anon** key, which cannot call
`auth.admin.deleteUser()`. The **service-role** key, which can, must
never ship to a browser. The function bridges the two:

1. The caller sends its user JWT in the `Authorization: Bearer …`
   header.
2. The function uses the anon client to `getUser()` from that JWT —
   which both validates the signature and resolves the user id.
3. The function then switches to a service-role client and calls
   `auth.admin.deleteUser(userId)`.

Because every user-owned table in the `public` schema references
`auth.users(id) ON DELETE CASCADE`, deleting the auth row sweeps:

- `public.portfolios`
- `public.profiles`
- `public.holdings`
- `public.transactions`
- `public.open_orders`
- `public.filled_orders`
- `public.leaderboard`

## Deploy

```bash
# From the repo root:
supabase functions deploy delete-account --project-ref <your-project-ref>
```

If you don't have the Supabase CLI installed, deploying from the
dashboard also works: Dashboard → Edge Functions → Create a new
function → paste `index.ts`.

## Secrets

The function reads three environment variables, which Supabase wires
up for you automatically when the function is deployed:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

No manual secret setup is required.

## Verify the endpoint is live

```bash
curl -i -X OPTIONS https://<project-ref>.supabase.co/functions/v1/delete-account
# Expect: HTTP/2 200, with Access-Control-Allow-Origin headers.
```

And from the signed-in client console:

```js
await fetch(window.SUPABASE.supabaseUrl + '/functions/v1/delete-account', {
  method: 'POST',
  headers: {
    Authorization: 'Bearer ' + (await window.SUPABASE.auth.getSession()).data.session.access_token,
    'Content-Type': 'application/json',
  },
  body: '{}',
}).then(r => r.status);
// 200 → deleted. 401 → bad JWT. 500 → service misconfigured.
```

## Future work

If we later add a user-owned table without an `ON DELETE CASCADE`
constraint, add an explicit cleanup to `index.ts` **before** the
`admin.deleteUser` call. After the auth row is gone, orphaned rows in
a non-cascading table become RLS-inaccessible (their `user_id` no
longer resolves) but still occupy space on disk.
