"""Private Network Access (PNA): localhost 등에서 사설 IP로 API를 호출할 때 브라우저 프리플라이트용."""

from __future__ import annotations

from collections.abc import Awaitable, Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response


class PrivateNetworkAccessMiddleware(BaseHTTPMiddleware):
    """
    Chrome 등: ``http://localhost`` → ``http://10.x...`` 요청 시 OPTIONS에
    ``Access-Control-Allow-Private-Network: true``가 없으면 CORS로 막힌다.

    See: https://wicg.github.io/private-network-access/
    """

    async def dispatch(self, request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
        response = await call_next(request)
        if request.headers.get("access-control-request-private-network") == "true":
            response.headers["Access-Control-Allow-Private-Network"] = "true"
        return response
