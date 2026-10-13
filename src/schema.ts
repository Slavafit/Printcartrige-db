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
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (manufacturer_id, normalized_model_name)
);

CREATE TABLE IF NOT EXISTS cartridges (
  id INTEGER PRIMARY KEY,
  manufacturer_id INTEGER NOT NULL REFERENCES manufacturers(id) ON DELETE RESTRICT,
  part_number TEXT NOT NULL,
  normalized_part_number TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('ink', 'toner', 'drum', 'waste_toner', 'belt', 'other', 'unknown')),
  origin_type TEXT NOT NULL DEFAULT 'unknown' CHECK (origin_type IN ('oem', 'compatible', 'remanufactured', 'unknown')),
  supply_form TEXT CHECK (supply_form IS NULL OR supply_form = 'ink_bottle'),
  color TEXT,
  yield_pages INTEGER CHECK (yield_pages IS NULL OR yield_pages > 0),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (manufacturer_id, normalized_part_number)
);

CREATE TABLE IF NOT EXISTS data_sources (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  source_category TEXT NOT NULL DEFAULT 'official' CHECK (source_category IN ('official', 'third_party', 'open_dataset', 'manual', 'unknown')),
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
  source_type TEXT CHECK (source_type IS NULL OR source_type IN ('official-manufacturer', 'other')),
  evidence_type TEXT CHECK (evidence_type IS NULL OR evidence_type IN ('explicit-compatibility', 'product-page-only', 'other')),
  evidence TEXT,
  verified_at TEXT,
  reliability_status TEXT NOT NULL DEFAULT 'unverified' CHECK (reliability_status IN ('official_verified', 'third_party_reported', 'unverified', 'conflicting')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (printer_id, cartridge_id, source_url, region)
);

CREATE TABLE IF NOT EXISTS compatibility_sources (
  id INTEGER PRIMARY KEY,
  compatibility_id INTEGER NOT NULL REFERENCES compatibility(id) ON DELETE CASCADE,
  source_id INTEGER NOT NULL REFERENCES data_sources(id) ON DELETE RESTRICT,
  source_reference TEXT NOT NULL,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  raw_printer_model TEXT,
  raw_supply_part_number TEXT,
  raw_description TEXT,
  verification_status TEXT NOT NULL CHECK (verification_status IN ('official_verified', 'third_party_reported', 'unverified', 'conflicting')),
  region TEXT NOT NULL DEFAULT 'unknown',
  note TEXT,
  evidence_type TEXT,
  evidence TEXT,
  verified_at TEXT,
  UNIQUE (compatibility_id, source_id, source_reference, region, raw_printer_model, raw_supply_part_number)
);

-- Additive migration for printer records discovered independently of cartridge compatibility.
CREATE TABLE IF NOT EXISTS printer_sources (
  id INTEGER PRIMARY KEY,
  printer_id INTEGER NOT NULL REFERENCES printers(id) ON DELETE CASCADE,
  source_id INTEGER NOT NULL REFERENCES data_sources(id) ON DELETE RESTRICT,
  source_url TEXT NOT NULL,
  verification_status TEXT NOT NULL CHECK (verification_status IN ('unverified', 'verified', 'rejected')),
  region TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (printer_id, source_url, region)
);

CREATE INDEX IF NOT EXISTS idx_printers_manufacturer ON printers(manufacturer_id);
CREATE INDEX IF NOT EXISTS idx_cartridges_manufacturer ON cartridges(manufacturer_id);
CREATE INDEX IF NOT EXISTS idx_compatibility_printer ON compatibility(printer_id);
CREATE INDEX IF NOT EXISTS idx_compatibility_cartridge ON compatibility(cartridge_id);
CREATE INDEX IF NOT EXISTS idx_compatibility_sources_compatibility ON compatibility_sources(compatibility_id);
CREATE INDEX IF NOT EXISTS idx_printer_sources_printer ON printer_sources(printer_id);
`;
