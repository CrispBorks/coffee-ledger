import { Navigate, Route, Routes } from "react-router-dom";

import { TokenGate } from "@/components/token-gate";
import { Toaster } from "@/components/ui/sonner";
import { AddEntryPage } from "@/pages/add-entry-page";
import { CatalogPage } from "@/pages/catalog-page";
import { EntryPage } from "@/pages/entry-page";
import { useLedger } from "@/lib/ledger";

export default function App() {
  const { status } = useLedger();

  // Nothing of the app renders until the server has accepted a token, so no
  // page can flash someone's coffees or sit on an empty ledger that isn't theirs.
  if (status === "locked") {
    return (
      <>
        <TokenGate />
        <Toaster />
      </>
    );
  }

  return (
    <>
      <Routes>
        <Route path="/" element={<CatalogPage />} />
        <Route path="/entry/:id" element={<EntryPage />} />
        <Route path="/add" element={<AddEntryPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Toaster />
    </>
  );
}
