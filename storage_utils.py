"""Supabase Storage helpers — tutti i file dell'app vanno qui."""
import mimetypes
import os

import httpx

SUPABASE_URL   = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY   = os.getenv("SUPABASE_SERVICE_KEY", "")
STORAGE_BUCKET = os.getenv("SUPABASE_BUCKET", "pth")


def _headers(content_type: str | None = None) -> dict:
    h = {
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "apikey": SUPABASE_KEY,
    }
    if content_type:
        h["Content-Type"] = content_type
    return h


def upload_file(local_path: str, storage_path: str) -> None:
    """Carica un file locale su Supabase Storage (upsert)."""
    mime, _ = mimetypes.guess_type(local_path)
    with open(local_path, "rb") as f:
        content = f.read()
    url = f"{SUPABASE_URL}/storage/v1/object/{STORAGE_BUCKET}/{storage_path}"
    headers = {**_headers(mime or "application/octet-stream"), "x-upsert": "true"}
    resp = httpx.put(url, content=content, headers=headers, timeout=300)
    resp.raise_for_status()


def upload_bytes(data: bytes, storage_path: str, content_type: str = "application/octet-stream") -> None:
    """Carica bytes raw su Supabase Storage (upsert)."""
    url = f"{SUPABASE_URL}/storage/v1/object/{STORAGE_BUCKET}/{storage_path}"
    headers = {**_headers(content_type), "x-upsert": "true"}
    resp = httpx.put(url, content=data, headers=headers, timeout=120)
    resp.raise_for_status()


def get_signed_url(storage_path: str, expires_in: int = 3600) -> str:
    """Ritorna un URL firmato temporaneo per scaricare un file."""
    url = f"{SUPABASE_URL}/storage/v1/object/sign/{STORAGE_BUCKET}/{storage_path}"
    resp = httpx.post(url, json={"expiresIn": expires_in}, headers=_headers("application/json"), timeout=30)
    resp.raise_for_status()
    signed = resp.json()["signedURL"]
    return f"{SUPABASE_URL}/storage/v1{signed}"


def list_files(folder_path: str) -> list[dict]:
    """
    Elenca i file in una cartella di Supabase Storage.
    folder_path es. "jobs/abc-123"
    Ritorna lista di {"name": str, "size_mb": float}
    """
    # Supabase list API: POST /storage/v1/object/list/{bucket}
    # con body {"prefix": "jobs/abc-123/", "limit": 200}
    url = f"{SUPABASE_URL}/storage/v1/object/list/{STORAGE_BUCKET}"
    prefix = folder_path.rstrip("/") + "/"
    resp = httpx.post(url, json={"prefix": prefix, "limit": 200}, headers=_headers("application/json"), timeout=30)
    if resp.status_code != 200:
        return []
    items = resp.json()
    result = []
    for item in items:
        name = item.get("name", "")
        size_bytes = (item.get("metadata") or {}).get("size", 0) or 0
        result.append({"name": name, "size_mb": round(size_bytes / (1024 * 1024), 2)})
    return result
