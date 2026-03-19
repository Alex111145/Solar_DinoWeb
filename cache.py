"""
Cache in memoria con TTL — evita query ripetute al DB per dati statici.
Thread-safe tramite threading.Lock.
"""
import threading
import time
from typing import Any, Optional

_store: dict[str, tuple[Any, float]] = {}
_lock  = threading.Lock()


def get(key: str) -> Optional[Any]:
    with _lock:
        entry = _store.get(key)
        if entry is None:
            return None
        value, expires_at = entry
        if time.monotonic() > expires_at:
            del _store[key]
            return None
        return value


def set(key: str, value: Any, ttl: int = 60) -> None:
    """Salva `value` in cache per `ttl` secondi."""
    with _lock:
        _store[key] = (value, time.monotonic() + ttl)


def invalidate(key: str) -> None:
    """Rimuove una chiave dalla cache (da chiamare dopo write sul DB)."""
    with _lock:
        _store.pop(key, None)
