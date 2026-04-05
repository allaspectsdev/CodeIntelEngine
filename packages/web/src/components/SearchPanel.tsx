import React, { useState, type FormEvent } from "react";

interface SearchPanelProps {
  onSearch: (query: string) => void;
}

export function SearchPanel({ onSearch }: SearchPanelProps) {
  const [query, setQuery] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (query.trim()) {
      onSearch(query.trim());
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", gap: "8px" }}>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search symbols, files, or ask a question..."
        style={{
          flex: 1,
          padding: "6px 12px",
          borderRadius: "6px",
          border: "1px solid #30363d",
          background: "#0d1117",
          color: "#c9d1d9",
          fontSize: "14px",
          outline: "none",
        }}
      />
      <button
        type="submit"
        style={{
          padding: "6px 16px",
          borderRadius: "6px",
          border: "1px solid #30363d",
          background: "#21262d",
          color: "#c9d1d9",
          fontSize: "14px",
          cursor: "pointer",
        }}
      >
        Search
      </button>
    </form>
  );
}
