-- CinePulse v3.8.28 EXPERIMENTAL schema only.
-- Apply to a dedicated STAGING D1 database after backup/approval.
-- Never execute against stable cinepulse-android-db automatically.
-- R2 stores the portable SQLite snapshot; D1 only stores metadata/search rows.
CREATE TABLE IF NOT EXISTS experimental_scene_indexes (
  project_id TEXT NOT NULL,
  source_srt_sha256 TEXT NOT NULL CHECK(length(source_srt_sha256)=64),
  version INTEGER NOT NULL CHECK(version >= 1),
  r2_snapshot_key TEXT NOT NULL,
  snapshot_sha256 TEXT NOT NULL CHECK(length(snapshot_sha256)=64),
  status TEXT NOT NULL CHECK(status IN ('building','ready','failed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(project_id, source_srt_sha256, version)
);

CREATE TABLE IF NOT EXISTS experimental_scene_windows (
  project_id TEXT NOT NULL,
  source_srt_sha256 TEXT NOT NULL,
  version INTEGER NOT NULL,
  window_id TEXT NOT NULL,
  source_start_ms INTEGER NOT NULL CHECK(source_start_ms >= 0),
  source_end_ms INTEGER NOT NULL CHECK(source_end_ms > source_start_ms),
  cue_start INTEGER NOT NULL CHECK(cue_start > 0),
  cue_end INTEGER NOT NULL CHECK(cue_end >= cue_start),
  subtitle_text TEXT NOT NULL,
  character_events_json TEXT NOT NULL DEFAULT '{}',
  visual_verified INTEGER NOT NULL DEFAULT 0 CHECK(visual_verified = 0),
  PRIMARY KEY(project_id, source_srt_sha256, version, window_id),
  FOREIGN KEY(project_id,source_srt_sha256,version)
    REFERENCES experimental_scene_indexes(project_id,source_srt_sha256,version)
);

CREATE INDEX IF NOT EXISTS idx_exp_scene_windows_timeline
  ON experimental_scene_windows(project_id,source_start_ms,source_end_ms);

CREATE VIRTUAL TABLE IF NOT EXISTS experimental_scene_fts USING fts5(
  project_id UNINDEXED,
  window_id UNINDEXED,
  subtitle_text
);

CREATE TABLE IF NOT EXISTS experimental_package_assets (
  project_id TEXT NOT NULL,
  asset_kind TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  sha256 TEXT NOT NULL CHECK(length(sha256)=64),
  bytes INTEGER NOT NULL CHECK(bytes > 0),
  source_srt_sha256 TEXT NOT NULL CHECK(length(source_srt_sha256)=64),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(project_id,asset_kind)
);

CREATE TABLE IF NOT EXISTS experimental_cut_plan_versions (
  project_id TEXT NOT NULL,
  language TEXT NOT NULL CHECK(language IN ('english','urdu')),
  revision INTEGER NOT NULL CHECK(revision >= 1),
  narration_srt_sha256 TEXT NOT NULL CHECK(length(narration_srt_sha256)=64),
  r2_cut_plan_key TEXT NOT NULL,
  reviewed_by_muse INTEGER NOT NULL DEFAULT 0 CHECK(reviewed_by_muse IN (0,1)),
  state TEXT NOT NULL CHECK(state IN ('draft','verified','needs_review')),
  PRIMARY KEY(project_id,language,revision)
);
