"""Supabase Storage helpers — tutti i file dell'app vanno qui."""
import mimetypes
import os
from typing import Optional

import httpx


def _cfg() -> tuple[str, str, str]:
    """Legge le variabili d'ambiente a runtime — evita problemi di ordine di import."""
    return (
        os.getenv("SUPABASE_URL", ""),
        os.getenv("SUPABASE_SERVICE_KEY", ""),
        os.getenv("SUPABASE_BUCKET", "pth"),
    )


def _headers(content_type: Optional[str] = None) -> dict:
    _, key, _ = _cfg()
    h = {
        "Authorization": f"Bearer {key}",
        "apikey": key,
    }
    if content_type:
        h["Content-Type"] = content_type
    return h


def upload_file(local_path: str, storage_path: str) -> None:
    """Carica un file locale su Supabase Storage (upsert)."""
    supabase_url, _, bucket = _cfg()
    mime, _ = mimetypes.guess_type(local_path)
    with open(local_path, "rb") as f:
        content = f.read()
    url = f"{supabase_url}/storage/v1/object/{bucket}/{storage_path}"
    headers = {**_headers(mime or "application/octet-stream"), "x-upsert": "true"}
    resp = httpx.put(url, content=content, headers=headers, timeout=300)
    resp.raise_for_status()


def upload_bytes(data: bytes, storage_path: str, content_type: str = "application/octet-stream") -> None:
    """Carica bytes raw su Supabase Storage (upsert)."""
    supabase_url, _, bucket = _cfg()
    url = f"{supabase_url}/storage/v1/object/{bucket}/{storage_path}"
    headers = {**_headers(content_type), "x-upsert": "true"}
    resp = httpx.put(url, content=data, headers=headers, timeout=120)
    resp.raise_for_status()


def get_signed_url(storage_path: str, expires_in: int = 3600) -> str:
    """Ritorna un URL firmato temporaneo per scaricare un file."""
    supabase_url, _, bucket = _cfg()
    url = f"{supabase_url}/storage/v1/object/sign/{bucket}/{storage_path}"
    resp = httpx.post(url, json={"expiresIn": expires_in}, headers=_headers("application/json"), timeout=30)
    resp.raise_for_status()
    signed = resp.json()["signedURL"]
    return f"{supabase_url}/storage/v1{signed}"


def list_files(folder_path: str) -> list[dict]:
    """
    Elenca i file in una cartella di Supabase Storage.
    folder_path es. "jobs/abc-123"
    Ritorna lista di {"name": str, "size_mb": float}
    """
    supabase_url, _, bucket = _cfg()
    url = f"{supabase_url}/storage/v1/object/list/{bucket}"
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


def delete_files(paths: list[str]) -> int:
    """Elimina più file da Supabase Storage. Ritorna il numero di file eliminati."""
    if not paths:
        return 0
    supabase_url, _, bucket = _cfg()
    url = f"{supabase_url}/storage/v1/object/{bucket}"
    resp = httpx.delete(url, json={"prefixes": paths}, headers=_headers("application/json"), timeout=60)
    if resp.status_code not in (200, 204):
        return 0
    return len(paths)
