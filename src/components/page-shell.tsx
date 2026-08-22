import { Link } from "react-router-dom";
import { ArrowLeftIcon } from "lucide-react";

import { LedgerStatus } from "@/components/ledger-status";
import { cn } from "@/lib/utils";

export function PageShell({
  children,
  className,
  width = "wide",
}: {
  children: React.ReactNode;
  className?: string;
  width?: "wide" | "reading";
}) {
  return (
    <div
      className={cn(
        "mx-auto flex w-full flex-col px-5",
        "pb-[max(4rem,calc(env(safe-area-inset-bottom)+3rem))]",
        width === "wide" ? "max-w-[920px]" : "max-w-[760px]",
        className,
      )}
    >
      {children}
      {/* Saving happens on its own now, so the only place it surfaces is a
          corner that stays quiet until something hasn't landed. */}
      <LedgerStatus />
    </div>
  );
}

export function BackLink({ to = "/", children = "Back to ledger" }) {
  return (
    <Link
      to={to}
      className="label-mono inline-flex items-center gap-1.5 py-1 text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeftIcon className="size-3.5" />
      {children}
    </Link>
  );
}

export function SiteFooter() {
  return (
    <footer className="no-print mt-16 border-t border-border pt-6 text-[13px] text-muted-foreground">
      With ❤️ from{" "}
      <a
        className="underline underline-offset-2 hover:text-foreground"
        href="https://atharva-bhagwat.github.io/"
        target="_blank"
        rel="noopener noreferrer"
      >
        Atharva
      </a>{" "}
      and{" "}
      <a
        className="underline underline-offset-2 hover:text-foreground"
        href="https://www.yashraut.com/"
        target="_blank"
        rel="noopener noreferrer"
      >
        Yash
      </a>{" "}
      · Made with{" "}
      <a
        className="underline underline-offset-2 hover:text-foreground"
        href="https://claude.ai/"
        target="_blank"
        rel="noopener noreferrer"
      >
        Claude
      </a>
      .
    </footer>
  );
}
