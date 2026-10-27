/**
 * Official channels — one source of truth.
 *
 * Every link in the product (footer, header, docs, admin console, share intents, metadata) reads
 * from here, so a handle change is a one-line edit instead of a hunt through components. Handles
 * were verified against the accounts themselves: the Telegram channel description points at
 * x.com/Pred_Arena, and x.com/PredictionArena belongs to an unrelated sports-news account — which is
 * exactly why nothing in the app may hardcode a guessable handle.
 */

export const SOCIAL = {
  x: {
    label: "X / Twitter",
    handle: "@Pred_Arena",
    url: "https://x.com/Pred_Arena",
  },
  telegram: {
    label: "Telegram",
    handle: "@prediction_arena",
    url: "https://t.me/prediction_arena",
  },
  github: {
    label: "GitHub",
    url: "https://github.com/lulaxiao97-create/prediction-arena",
  },
} as const;

/** Bare handle used in copy and in share intents' `via` parameter. */
export const X_HANDLE = SOCIAL.x.handle.replace(/^@/, "");

/**
 * Appends the official handle to an X/Twitter intent URL so a shared post is attributed to the
 * account instead of a stranger's similarly-named one.
 */
export function withVia(intentUrl: string): string {
  const url = new URL(intentUrl);
  url.searchParams.set("via", X_HANDLE);
  return url.toString();
}

export const EXTERNAL_LINK_PROPS = {
  target: "_blank",
  rel: "noopener noreferrer",
} as const;
