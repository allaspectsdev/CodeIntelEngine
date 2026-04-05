import type Database from "better-sqlite3";

export interface Migration {
  version: number;
  description: string;
  up(db: Database.Database): void;
}

export const migrations: Migration[] = [
  {
    version: 1,
    description: "Initial schema — nodes, edges, communities, processes, FTS",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS _meta (
          key   TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS nodes (
          id            TEXT PRIMARY KEY,
          kind          TEXT NOT NULL,
          name          TEXT NOT NULL,
          file_path     TEXT NOT NULL,
          start_line    INTEGER NOT NULL,
          end_line      INTEGER NOT NULL,
          content_hash  TEXT NOT NULL,
          language      TEXT NOT NULL,
          signature     TEXT,
          docstring     TEXT,
          exported      INTEGER NOT NULL DEFAULT 0,
          last_indexed  INTEGER NOT NULL,
          community_id  INTEGER,
          page_rank     REAL DEFAULT 0.0,
          embedding     BLOB,
          metadata      TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_nodes_file ON nodes(file_path);
        CREATE INDEX IF NOT EXISTS idx_nodes_kind ON nodes(kind);
        CREATE INDEX IF NOT EXISTS idx_nodes_name ON nodes(name);
        CREATE INDEX IF NOT EXISTS idx_nodes_community ON nodes(community_id);
        CREATE INDEX IF NOT EXISTS idx_nodes_hash ON nodes(content_hash);

        CREATE TABLE IF NOT EXISTS edges (
          id          TEXT PRIMARY KEY,
          source      TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
          target      TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
          kind        TEXT NOT NULL,
          confidence  REAL NOT NULL DEFAULT 1.0,
          file_path   TEXT,
          line        INTEGER,
          metadata    TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source);
        CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target);
        CREATE INDEX IF NOT EXISTS idx_edges_kind ON edges(kind);
        CREATE INDEX IF NOT EXISTS idx_edges_source_kind ON edges(source, kind);

        CREATE TABLE IF NOT EXISTS communities (
          id            INTEGER PRIMARY KEY,
          label         TEXT NOT NULL,
          member_count  INTEGER NOT NULL DEFAULT 0,
          cohesion      REAL NOT NULL DEFAULT 0.0
        );

        CREATE TABLE IF NOT EXISTS processes (
          id          TEXT PRIMARY KEY,
          name        TEXT NOT NULL,
          entry_point TEXT NOT NULL,
          steps       TEXT NOT NULL,
          kind        TEXT NOT NULL
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
          name, signature, docstring,
          content='nodes',
          content_rowid='rowid'
        );

        -- Triggers to keep FTS in sync
        CREATE TRIGGER IF NOT EXISTS nodes_ai AFTER INSERT ON nodes BEGIN
          INSERT INTO nodes_fts(rowid, name, signature, docstring)
          VALUES (new.rowid, new.name, new.signature, new.docstring);
        END;

        CREATE TRIGGER IF NOT EXISTS nodes_ad AFTER DELETE ON nodes BEGIN
          INSERT INTO nodes_fts(nodes_fts, rowid, name, signature, docstring)
          VALUES ('delete', old.rowid, old.name, old.signature, old.docstring);
        END;

        CREATE TRIGGER IF NOT EXISTS nodes_au AFTER UPDATE ON nodes BEGIN
          INSERT INTO nodes_fts(nodes_fts, rowid, name, signature, docstring)
          VALUES ('delete', old.rowid, old.name, old.signature, old.docstring);
          INSERT INTO nodes_fts(rowid, name, signature, docstring)
          VALUES (new.rowid, new.name, new.signature, new.docstring);
        END;
      `);
    },
  },
];

export function runMigrations(db: Database.Database): void {
  // Ensure _meta table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS _meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const getVersion = db.prepare("SELECT value FROM _meta WHERE key = 'schema_version'");
  const setVersion = db.prepare(
    "INSERT OR REPLACE INTO _meta (key, value) VALUES ('schema_version', ?)"
  );

  const row = getVersion.get() as { value: string } | undefined;
  const currentVersion = row ? parseInt(row.value, 10) : 0;

  const pending = migrations.filter((m) => m.version > currentVersion);
  if (pending.length === 0) return;

  const runAll = db.transaction(() => {
    for (const migration of pending) {
      migration.up(db);
      setVersion.run(migration.version.toString());
    }
  });

  runAll();
}
