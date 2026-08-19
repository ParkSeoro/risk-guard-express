"""Gateway의 durable event spool과 command journal."""

from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .models import CommandAck, CommandStatus, SafetyEvent


class EdgeStore:
    def __init__(self, database_path: Path) -> None:
        database_path.parent.mkdir(parents=True, exist_ok=True)
        self._connection = sqlite3.connect(database_path, check_same_thread=False)
        self._connection.row_factory = sqlite3.Row
        self._connection.execute("PRAGMA journal_mode=WAL")
        self._connection.execute("PRAGMA foreign_keys=ON")
        self._connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS event_spool (
              event_id TEXT PRIMARY KEY,
              payload_json TEXT NOT NULL,
              created_at TEXT NOT NULL,
              attempts INTEGER NOT NULL DEFAULT 0,
              last_attempt_at TEXT,
              accepted_at TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_event_spool_pending
              ON event_spool(accepted_at, created_at);

            CREATE TABLE IF NOT EXISTS command_journal (
              command_id TEXT PRIMARY KEY,
              idempotency_key TEXT NOT NULL UNIQUE,
              payload_digest TEXT NOT NULL,
              status TEXT NOT NULL,
              detail TEXT,
              before_state_version INTEGER,
              after_state_version INTEGER,
              error_code TEXT,
              updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS runtime_state (
              state_key TEXT PRIMARY KEY,
              state_value TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            """
        )
        self._connection.commit()

    @staticmethod
    def _now() -> str:
        return datetime.now(UTC).isoformat()

    def close(self) -> None:
        self._connection.close()

    def enqueue_event(self, event: SafetyEvent) -> bool:
        """새 event를 저장한다. 같은 event ID는 멱등적으로 무시한다."""
        cursor = self._connection.execute(
            """
            INSERT OR IGNORE INTO event_spool(event_id, payload_json, created_at)
            VALUES (?, ?, ?)
            """,
            (
                str(event.event_id),
                event.model_dump_json(),
                self._now(),
            ),
        )
        self._connection.commit()
        return cursor.rowcount == 1

    def pending_events(self, limit: int = 100) -> list[SafetyEvent]:
        rows = self._connection.execute(
            """
            SELECT payload_json FROM event_spool
            WHERE accepted_at IS NULL
            ORDER BY created_at ASC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
        return [SafetyEvent.model_validate_json(row["payload_json"]) for row in rows]

    def mark_event_attempt(self, event_ids: list[str]) -> None:
        if not event_ids:
            return
        placeholders = ",".join("?" for _ in event_ids)
        self._connection.execute(
            f"""
            UPDATE event_spool
            SET attempts = attempts + 1, last_attempt_at = ?
            WHERE event_id IN ({placeholders})
            """,
            (self._now(), *event_ids),
        )
        self._connection.commit()

    def mark_events_accepted(self, event_ids: list[str]) -> None:
        if not event_ids:
            return
        placeholders = ",".join("?" for _ in event_ids)
        self._connection.execute(
            f"UPDATE event_spool SET accepted_at = ? WHERE event_id IN ({placeholders})",
            (self._now(), *event_ids),
        )
        self._connection.commit()

    def prune_accepted_events(self, older_than_iso: str) -> int:
        cursor = self._connection.execute(
            "DELETE FROM event_spool WHERE accepted_at IS NOT NULL AND accepted_at < ?",
            (older_than_iso,),
        )
        self._connection.commit()
        return cursor.rowcount

    def event_spool_depth(self) -> int:
        row = self._connection.execute("SELECT COUNT(*) AS total FROM event_spool WHERE accepted_at IS NULL").fetchone()
        return int(row["total"])

    def get_command_status(self, command_id: str) -> CommandStatus | None:
        row = self._connection.execute(
            "SELECT status FROM command_journal WHERE command_id = ?", (command_id,)
        ).fetchone()
        return CommandStatus(row["status"]) if row else None

    def command_idempotency_conflict(self, idempotency_key: str, payload_digest: str) -> bool:
        row = self._connection.execute(
            "SELECT payload_digest FROM command_journal WHERE idempotency_key = ?", (idempotency_key,)
        ).fetchone()
        return row is not None and row["payload_digest"] != payload_digest

    def write_command_ack(self, ack: CommandAck, idempotency_key: str, payload_digest: str) -> None:
        self._connection.execute(
            """
            INSERT INTO command_journal(
              command_id, idempotency_key, payload_digest, status, detail,
              before_state_version, after_state_version, error_code, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(command_id) DO UPDATE SET
              status = excluded.status,
              detail = excluded.detail,
              before_state_version = excluded.before_state_version,
              after_state_version = excluded.after_state_version,
              error_code = excluded.error_code,
              updated_at = excluded.updated_at
            """,
            (
                str(ack.command_id),
                idempotency_key,
                payload_digest,
                ack.status.value,
                ack.detail,
                ack.before_state_version,
                ack.after_state_version,
                ack.error_code,
                self._now(),
            ),
        )
        self._connection.commit()

    def get_runtime_value(self, key: str, default: Any = None) -> Any:
        row = self._connection.execute(
            "SELECT state_value FROM runtime_state WHERE state_key = ?", (key,)
        ).fetchone()
        return json.loads(row["state_value"]) if row else default

    def set_runtime_value(self, key: str, value: Any) -> None:
        self._connection.execute(
            """
            INSERT INTO runtime_state(state_key, state_value, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(state_key) DO UPDATE SET state_value = excluded.state_value, updated_at = excluded.updated_at
            """,
            (key, json.dumps(value, separators=(",", ":")), self._now()),
        )
        self._connection.commit()

    def next_heartbeat_sequence(self) -> int:
        current = int(self.get_runtime_value("heartbeat_sequence", 0)) + 1
        self.set_runtime_value("heartbeat_sequence", current)
        return current
