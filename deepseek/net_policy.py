"""Shared outbound-network policy for DeepSeek CLI.

The policy is deliberately independent from ToolRegistry so every HTTP-capable
module can apply the same checks, including redirects discovered at runtime.
"""

from __future__ import annotations

import ipaddress
import os
import socket
from urllib.parse import urljoin, urlparse


class NetworkPolicyError(ValueError):
    """Raised when an outbound URL violates the local egress policy."""


_BLOCKED_HOSTS = {
    "metadata.google.internal",
    "metadata.google",
    "instance-data",
    "kubernetes.default",
    "kubernetes.default.svc",
}
_BLOCKED_SUFFIXES = (".localhost", ".local", ".internal", ".home.arpa")
_ALLOWED_STANDARD_PORTS = {80, 443}
_REDIRECT_STATUSES = {301, 302, 303, 307, 308}


def private_network_allowed() -> bool:
    """Return whether the user explicitly opted into private-network access."""
    return os.environ.get("DEEPSEEK_ALLOW_PRIVATE_NETWORK") == "1"


def _normalized_ips(host: str, port: int) -> set[ipaddress.IPv4Address | ipaddress.IPv6Address]:
    addresses: set[ipaddress.IPv4Address | ipaddress.IPv6Address] = set()
    for item in socket.getaddrinfo(host, port, type=socket.SOCK_STREAM):
        ip = ipaddress.ip_address(item[4][0].split("%", 1)[0])
        if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
            ip = ip.ipv4_mapped
        addresses.add(ip)
    return addresses


def url_policy_error(raw_url: str) -> str | None:
    """Validate one HTTP(S) destination before a connection is attempted."""
    if private_network_allowed():
        return None
    if not isinstance(raw_url, str) or not raw_url.strip():
        return "URL is required"
    try:
        parsed = urlparse(raw_url.strip())
    except ValueError as exc:
        return f"Invalid URL: {exc}"
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return "Only absolute http/https URLs are allowed"
    if parsed.username is not None or parsed.password is not None:
        return "Credentials embedded in URLs are not allowed"

    host = parsed.hostname.lower().rstrip(".")
    if host == "localhost" or host in _BLOCKED_HOSTS or host.endswith(_BLOCKED_SUFFIXES):
        return f"Local/internal hostname is blocked ({host})"

    try:
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
    except ValueError as exc:
        return f"Invalid port: {exc}"
    if port not in _ALLOWED_STANDARD_PORTS and os.environ.get("DEEPSEEK_ALLOW_NONSTANDARD_PORTS") != "1":
        return f"Non-standard outbound port is blocked ({port})"

    try:
        addresses = _normalized_ips(host, port)
    except socket.gaierror as exc:
        return f"DNS resolution failed for {host}: {exc}"
    except ValueError as exc:
        return f"Invalid destination address: {exc}"
    if not addresses:
        return f"DNS returned no address for {host}"

    for ip in addresses:
        # is_global excludes private, loopback, link-local, multicast,
        # unspecified, documentation, reserved, and other special ranges.
        if not ip.is_global:
            return f"Private/local/special destination is blocked ({ip})"
    return None


def validate_url(raw_url: str) -> str:
    """Return a normalized URL or raise NetworkPolicyError."""
    value = str(raw_url or "").strip()
    error = url_policy_error(value)
    if error:
        raise NetworkPolicyError(error)
    return value


def safe_httpx_request(client, method: str, url: str, *, max_redirects: int = 5,
                       stream: bool = False, max_response_bytes: int | None = None,
                       **kwargs):
    """Send an httpx request while validating every redirect destination.

    Redirects are followed manually.  The caller owns the returned response and
    must close it when ``stream=True``.  ``max_response_bytes`` is checked from
    Content-Length up front; streaming callers must also enforce an actual byte
    count because servers can omit or lie about Content-Length.
    """
    current_url = validate_url(url)
    current_method = method.upper()
    request_kwargs = dict(kwargs)

    for redirect_count in range(max_redirects + 1):
        request = client.build_request(current_method, current_url, **request_kwargs)
        bounded_buffer = max_response_bytes is not None and not stream
        # A non-streaming httpx send buffers the complete body before this
        # function can inspect it. Force streaming whenever a byte limit is
        # requested, then construct a normal buffered response only after the
        # decoded body has been proven to fit.
        response = client.send(
            request, stream=(stream or bounded_buffer), follow_redirects=False
        )
        declared = response.headers.get("content-length")
        if max_response_bytes is not None and declared:
            try:
                if int(declared) > max_response_bytes:
                    response.close()
                    raise NetworkPolicyError(
                        f"Response exceeds {max_response_bytes} byte limit"
                    )
            except ValueError:
                response.close()
                raise NetworkPolicyError("Invalid Content-Length response header")

        if response.status_code not in _REDIRECT_STATUSES:
            if not bounded_buffer:
                return response
            content = bytearray()
            try:
                for chunk in response.iter_bytes():
                    if len(content) + len(chunk) > max_response_bytes:
                        raise NetworkPolicyError(
                            f"Response exceeds {max_response_bytes} byte limit"
                        )
                    content.extend(chunk)
                status_code = response.status_code
                headers = response.headers
                extensions = dict(response.extensions)
            finally:
                response.close()
            return response.__class__(
                status_code=status_code,
                headers=headers,
                content=bytes(content),
                request=request,
                extensions=extensions,
            )

        location = response.headers.get("location")
        response.close()
        if not location:
            raise NetworkPolicyError("Redirect response has no Location header")
        if redirect_count >= max_redirects:
            raise NetworkPolicyError("Too many redirects")

        current_url = validate_url(urljoin(current_url, location))
        if response.status_code == 303 or (
            response.status_code in {301, 302} and current_method not in {"GET", "HEAD"}
        ):
            current_method = "GET"
            request_kwargs.pop("data", None)
            request_kwargs.pop("json", None)
            request_kwargs.pop("content", None)
        # Query params belong to the first request. Redirect Location already
        # carries any query parameters intended for the next request.
        request_kwargs.pop("params", None)

    raise NetworkPolicyError("Too many redirects")
