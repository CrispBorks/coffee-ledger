import { Link } from "react-router-dom";
import { PlusIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";

export function SiteHeader() {
  return (
    <header className="no-print mb-7 border-b border-border pt-9 pb-5">
      <div className="flex items-center justify-between gap-4">
        <Link to="/" className="display text-[28px] leading-none font-semibold">
          Coffee Ledger
        </Link>
        <ThemeToggle />
      </div>

      <nav aria-label="Actions" className="mt-4 flex items-center gap-2">
        <Button asChild>
          <Link to="/add">
            <PlusIcon />
            Add coffee
          </Link>
        </Button>
      </nav>
    </header>
  );
}
