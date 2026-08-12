import { Navigate, Route, Routes } from "react-router-dom";

import { Toaster } from "@/components/ui/sonner";
import { AddEntryPage } from "@/pages/add-entry-page";
import { CatalogPage } from "@/pages/catalog-page";
import { EntryPage } from "@/pages/entry-page";

export default function App() {
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
