"""
Simple backend server for the bybrooklyn.dev site.

Features:
- Serves static files for the landing page and blog.
- Provides a minimal authenticated API for creating and listing blog posts.
- Stores blog posts and session tokens in a SQLite database.

Usage:
  ADMIN_USERNAME defines the admin account (default: "admin").
  ADMIN_PASSWORD_HASH can be set to control the admin password.
  Generate a hash with:
      python - <<'PY'
      import hashlib
      password = "your-password"
      print(hashlib.sha256(password.encode("utf-8")).hexdigest())
      PY

  Then export ADMIN_PASSWORD_HASH before starting the server:
      export ADMIN_PASSWORD_HASH=...
      export ADMIN_USERNAME=your-admin-name  # optional
      python server.py

  BLOG_SESSION_HOURS configures how long issued tokens remain valid (default: 12).
"""

from __future__ import annotations

import hashlib
import os
import secrets
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Generator, Optional

from flask import (
    Flask,
    abort,
    g,
    jsonify,
    request,
    send_from_directory,
)

ROOT_DIR = Path(__file__).resolve().parent
DATABASE_PATH = ROOT_DIR / os.environ.get("BLOG_DB_PATH", "blog.db")
SESSION_HOURS = int(os.environ.get("BLOG_SESSION_HOURS", "12"))
DEFAULT_PASSWORD_HASH = (
    "d7e0462a864001404c9e3bd1fa559b1e5701fca134bf918315a644f450987ad9"
)
ADMIN_PASSWORD_HASH = os.environ.get("ADMIN_PASSWORD_HASH", DEFAULT_PASSWORD_HASH)
ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME", "admin")

app = Flask(__name__, static_folder=str(ROOT_DIR), static_url_path="")


def init_db() -> None:
    """Ensure the database exists with the required tables."""
    with sqlite3.connect(DATABASE_PATH) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS posts (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                body TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                expires_at TEXT NOT NULL
            )
            """
        )
        conn.commit()


@contextmanager
def get_conn() -> Generator[sqlite3.Connection, None, None]:
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


def verify_password(password: str) -> bool:
    proposed = hash_password(password)
    return secrets.compare_digest(proposed, ADMIN_PASSWORD_HASH)


def issue_token() -> tuple[str, datetime]:
    token = secrets.token_urlsafe(32)
    expiry = datetime.now(tz=timezone.utc) + timedelta(hours=SESSION_HOURS)
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO sessions (token, expires_at) VALUES (?, ?)",
            (token, expiry.isoformat()),
        )
        conn.commit()
    return token, expiry


def fetch_session(token: str) -> Optional[datetime]:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT expires_at FROM sessions WHERE token = ?", (token,)
        ).fetchone()
        if not row:
            return None
        try:
            return datetime.fromisoformat(row["expires_at"])
        except ValueError:
            return None


def delete_session(token: str) -> None:
    with get_conn() as conn:
        conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
        conn.commit()


def require_auth() -> None:
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        abort(401)
    token = auth_header.split(" ", 1)[1].strip()
    if not token:
        abort(401)

    expiry = fetch_session(token)
    if not expiry:
        abort(401)
    if expiry < datetime.now(tz=timezone.utc):
        delete_session(token)
        abort(401)

    g.token = token


@app.after_request
def add_security_headers(response):
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("X-XSS-Protection", "1; mode=block")
    return response


@app.route("/api/login", methods=["POST"])
def login():
    payload = request.get_json(silent=True) or {}
    username = (payload.get("username") or "").strip()
    password = payload.get("password")
    if not username or not password:
        abort(400, description="Username and password are required.")

    if not secrets.compare_digest(username, ADMIN_USERNAME):
        abort(401)

    if not verify_password(password):
        abort(401)

    token, expiry = issue_token()
    return jsonify(
        {"token": token, "expiresAt": expiry.isoformat(), "username": ADMIN_USERNAME}
    )


@app.route("/api/logout", methods=["POST"])
def logout():
    require_auth()
    delete_session(g.token)
    return jsonify({"status": "ok"})


@app.route("/api/posts", methods=["GET"])
def list_posts():
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, title, body, created_at FROM posts ORDER BY created_at DESC"
        ).fetchall()
    posts = [
        {
            "id": row["id"],
            "title": row["title"],
            "body": row["body"],
            "createdAt": row["created_at"],
        }
        for row in rows
    ]
    return jsonify({"posts": posts})


@app.route("/api/posts", methods=["POST"])
def create_post():
    require_auth()
    payload = request.get_json(silent=True) or {}
    title = (payload.get("title") or "").strip()
    body = (payload.get("body") or "").strip()

    if not title or not body:
        abort(400, description="Title and body are required.")

    post_id = secrets.token_urlsafe(12)
    created_at = datetime.now(tz=timezone.utc).isoformat()

    with get_conn() as conn:
        conn.execute(
            "INSERT INTO posts (id, title, body, created_at) VALUES (?, ?, ?, ?)",
            (post_id, title, body, created_at),
        )
        conn.commit()

    return (
        jsonify(
            {
                "id": post_id,
                "title": title,
                "body": body,
                "createdAt": created_at,
            }
        ),
        201,
    )


@app.route("/api/posts/<post_id>", methods=["DELETE"])
def delete_post(post_id: str):
    require_auth()
    with get_conn() as conn:
        deleted = conn.execute(
            "DELETE FROM posts WHERE id = ?", (post_id,)
        ).rowcount
        conn.commit()
    if not deleted:
        abort(404)
    return jsonify({"status": "deleted"})


@app.route("/", defaults={"path": "index.html"})
@app.route("/<path:path>")
def static_proxy(path: str):
    target = ROOT_DIR / path
    if target.is_dir():
        index_path = target / "index.html"
        if index_path.exists():
            return send_from_directory(str(target), "index.html")
    if target.exists() and target.is_file():
        return send_from_directory(str(ROOT_DIR), path)
    abort(404)


def main() -> None:
    init_db()
    port = int(os.environ.get("PORT", "5000"))
    app.run(host="0.0.0.0", port=port)


if __name__ == "__main__":
    main()
