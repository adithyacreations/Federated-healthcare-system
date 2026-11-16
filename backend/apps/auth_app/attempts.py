import hashlib

from django.core.cache import cache
from rest_framework.exceptions import Throttled


def limit_attempts(scope, identity, *, limit, window):
    """Count attempts atomically in Redis, or in the local cache in development."""
    digest = hashlib.sha256(identity.encode()).hexdigest()
    key = f'auth-attempts:{scope}:{digest}'
    if cache.add(key, 1, timeout=window):
        return
    try:
        count = cache.incr(key)
    except ValueError:
        # The counter expired between add and incr.
        if cache.add(key, 1, timeout=window):
            return
        count = cache.incr(key)
    if count > limit:
        raise Throttled(wait=window)
