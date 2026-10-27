"use client";

import { SOCIAL } from "@/lib/social";
import { BRAND_PATHS, BrandIcon, type BrandName } from "@/lib/brand-icons";
import { cn } from "@/lib/format";

/**
 * The official-channel buttons.
 *
 * Every anchor is `target="_blank" rel="noopener noreferrer"` and carries the handle in its
 * accessible name, so the link is both safe to click and readable by a screen reader.
 */
const CHANNELS: { name: BrandName; label: string; href: string; handle?: string }[] = [
  { name: "x", label: SOCIAL.x.label, href: SOCIAL.x.url, handle: SOCIAL.x.handle },
  { name: "telegram", label: SOCIAL.telegram.label, href: SOCIAL.telegram.url, handle: SOCIAL.telegram.handle },
  { name: "github", label: SOCIAL.github.label, href: SOCIAL.github.url },
];

export function SocialLinks({
  className,
  iconClassName,
  withLabels = false,
}: {
  className?: string;
  iconClassName?: string;
  withLabels?: boolean;
}) {
  return (
    <div className={cn("flex items-center gap-1", className)}>
      {CHANNELS.map(({ name, label, href, handle }) => (
        <a
          key={name}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={handle ? `${label} ${handle}` : label}
          title={handle ? `${label} · ${handle}` : label}
          className={cn(
            "group inline-flex items-center gap-1.5 rounded-lg border border-white/8 bg-white/[0.02] px-2 py-1.5 text-muted transition-all",
            "hover:-translate-y-0.5 hover:border-gold/40 hover:text-gold-bright",
            withLabels && "px-2.5"
          )}
        >
          <BrandIcon d={BRAND_PATHS[name]} className={cn("size-3.5", iconClassName)} />
          {withLabels && handle && <span className="mono text-[10.5px]">{handle}</span>}
          {withLabels && !handle && <span className="text-[10.5px]">{label}</span>}
        </a>
      ))}
    </div>
  );
}
