export const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS manufacturers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS printers (
  id INTEGER PRIMARY KEY,
  manufacturer_id INTEGER NOT NULL REFERENCES manufacturers(id) ON DELETE RESTRICT,
  model_name TEXT NOT NULL,
  normalized_model_name TEXT NOT NULL,
  has_replaceable_cartridges INTEGER NOT NULL DEFAULT 1 CHECK (has_replaceable_cartridges IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (manufacturer_id, normalized_model_name)
);

CREATE TABLE IF NOT EXISTS cartridges (
  id INTEGER PRIMARY KEY,
  manufacturer_id INTEGER NOT NULL REFERENCES manufacturers(id) ON DELETE RESTRICT,
  part_number TEXT NOT NULL,
  normalized_part_number TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('ink', 'toner')),
  color TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (manufacturer_id, normalized_part_number)
);

CREATE TABLE IF NOT EXISTS data_sources (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS compatibility (
  id INTEGER PRIMARY KEY,
  printer_id INTEGER NOT NULL REFERENCES printers(id) ON DELETE CASCADE,
  cartridge_id INTEGER NOT NULL REFERENCES cartridges(id) ON DELETE CASCADE,
  source_id INTEGER NOT NULL REFERENCES data_sources(id) ON DELETE RESTRICT,
  source_url TEXT NOT NULL,
  verification_status TEXT NOT NULL CHECK (verification_status IN ('unverified', 'verified', 'rejected')),
  region TEXT NOT NULL,
  is_genuine_oem INTEGER NOT NULL DEFAULT 1 CHECK (is_genuine_oem IN (0, 1)),
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (printer_id, cartridge_id, source_url, region)
);

CREATE INDEX IF NOT EXISTS idx_printers_manufacturer ON printers(manufacturer_id);
CREATE INDEX IF NOT EXISTS idx_cartridges_manufacturer ON cartridges(manufacturer_id);
CREATE INDEX IF NOT EXISTS idx_compatibility_printer ON compatibility(printer_id);
CREATE INDEX IF NOT EXISTS idx_compatibility_cartridge ON compatibility(cartridge_id);
`;
