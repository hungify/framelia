# Auth Conventions

## Auth Architecture

- Better Auth config lives in `src/lib/auth/auth.ts`.
- Auth utilities are centralized in `src/lib/auth/*`.
- In components, prefer shared auth hooks (`useAuth`, `useAuthSuspense`) from `src/lib/auth/hooks.ts`. These reuse the same auth data as the route loader.
- For route loaders under `_auth`, use `authQueryOptions` with the existing `context.queryClient`, similar to how the user is fetched in `_auth/route.tsx`.

## Route Guards

- Protected route layout is `src/routes/_auth/route.tsx`.
  - It enforces auth in `beforeLoad` using TanStack Query's `ensureQueryData(authQueryOptions())` for optimized navigation UX.
- Guest-only route layout is `src/routes/_guest/route.tsx`.
  - It redirects authenticated users away from login/signup routes.

## Server Functions and Mutations

- Server functions can be called from both server and client code.
  - Server call: executed directly on the server.
  - Client call: treated as RPC and executed through an HTTP API request.
- Treat protected server functions like protected API routes from a security perspective.
- If a server function requires auth, always apply `authMiddleware` from `src/lib/auth/middleware.ts`. This applies even when called from an auth-protected route (`routes/_auth/**`).
- Route-level `beforeLoad` guards protect route navigation/rendering, but they do not replace server-function authorization.
- When auth is required, middleware-provided user context is the source of truth.

## Social Sign-In

- `src/components/sign-in-social-button.tsx` calls `authClient.signIn.social({ provider, callbackURL })` on the client.
- GitHub/Google credentials are optional at the env-schema level (`src/env/server.ts`); without them, `socialProviders` in `auth.ts` resolves to `undefined` client id/secret and Better Auth returns an error for that provider at request time. Set `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` and/or `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` in `.env` to enable them.
- OAuth app callback/redirect URI: `http://localhost:8888/api/auth/callback/<provider>`.
