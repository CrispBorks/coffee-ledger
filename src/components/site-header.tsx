import { Link } from "react-router-dom";
import { PlusIcon, UserRoundIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SignOutButton } from "@/components/sign-out-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { useLedger } from "@/lib/ledger";

export function SiteHeader() {
  const { profile } = useLedger();
  const name = profile.name.trim();

  return (
    <header className="no-print mb-7 border-b border-border pt-9 pb-5">
      <div className="flex items-center justify-between gap-4">
        <Link to="/" className="display text-[28px] leading-none font-semibold">
          Coffee Ledger
        </Link>
        <div className="flex items-center">
          <ThemeToggle />
          <SignOutButton />
        </div>
      </div>

      <nav aria-label="Actions" className="mt-4 flex items-center gap-2">
        <Button asChild>
          <Link to="/add">
            <PlusIcon />
            Add coffee
          </Link>
        </Button>
        {/* Named once a name is set, so on a shared phone it's obvious whose
            ledger is open. Truncated rather than wrapped on a narrow screen. */}
        {/* `shrink` undoes the button's own shrink-0: this is the one item in
            the row allowed to give up width. */}
        <Button asChild variant="outline" className="min-w-0 shrink">
          <Link to="/profile" aria-label={name ? `Profile: ${name}` : "Profile"}>
            <UserRoundIcon />
            <span className="min-w-0 truncate">{name || "Profile"}</span>
          </Link>
        </Button>
      </nav>
    </header>
  );
}
