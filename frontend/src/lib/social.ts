/**
 * Official channels — one source of truth.
 *
 * Every link in the product (footer, header, docs, admin console, share intents, metadata) reads
 * from here, so a handle change is a one-line edit instead of a hunt through components. Handles
 * are verified against the accounts themselves: @Predict065 is the account we own and post from,
 * while x.com/PredictionArena belongs to an unrelated sports-news account — which is exactly why
 * nothing in the app may hardcode a guessable handle.
 */

export const SOCIAL = {
  /**
   * X is listed but currently unusable: the account is locked behind a palm/facial liveness check
   * that needs a camera this machine does not have. Keep the entry so nothing 404s, but every
   * surface that can choose a primary channel should prefer Bluesky until the X account is live.
   */
  x: {
    label: "X / Twitter",
    handle: "@Predict065",
    url: "https://x.com/Predict065",
    active: false,
  },
  bluesky: {
    label: "Bluesky",
    handle: "@predictionarena.bsky.social",
    url: "https://bsky.app/profile/predictionarena.bsky.social",
    active: true,
  },
  telegram: {
    label: "Telegram",
    handle: "@predictionarena_hq",
    url: "https://t.me/predictionarena_hq",
    /**
     * Named invite link for this surface. The bot is a channel admin, so it receives a
     * `chat_member` update carrying the invite link a new subscriber arrived through; giving every
     * surface its own named link (site / x / tg) turns "we gained subscribers" into "which surface
     * gained them". This one is the site footer.
     */
    inviteUrl: "https://t.me/+N50apEvzAvJlYTZh",
  },
  /**
   * DefiLlama lists the arena as a Base protocol (`category: Prediction Market`). Linking to the
   * listing is a two-way reference: their page is the one place strangers can find us without
   * following anything, and the link proves the TVL number is theirs, not ours.
   */
  defillama: {
    label: "DefiLlama",
    url: "https://defillama.com/protocol/prediction-arena",
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
