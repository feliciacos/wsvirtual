// src/App.tsx
import React from "react";
import AdminSettings from "./components/ui/AdminSettings";

export default function App() {
  // always open — non-closable modal as requested
  return (
    <div className="app-root">
      {/* page background uses the same greyish tone */}
      <div className="page-bg" />
      <AdminSettings open={true} />
    </div>
  );
}
