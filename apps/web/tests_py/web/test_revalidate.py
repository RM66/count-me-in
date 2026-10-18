"""The revalidation hop (ADR-023 + ADR-025): the internal route call
carries Data-Cache tags plus the occupancy-change signal the route
fans out via the Upstash Realtime SDK.

`occupancy_event` is pinned here — the contract-shaped dict refused for
the demo organizer. respx mocks the transport, so body assertions see
exactly what the route receives.
"""

import json

import httpx
import respx
from countmein.contracts.constants_gen import DEMO_ORGANIZER_ID
from countmein.web.revalidate import occupancy_event, trigger_revalidation

REVALIDATE_URL = "https://example.com/api/internal/revalidate"
SERVICE_ID = "01930000-0000-7000-8000-0000000000b1"
ORGANIZER_ID = "01930000-0000-7000-8000-0000000000aa"


def _env(monkeypatch):
    monkeypatch.setenv("APP_URL", "https://example.com")
    monkeypatch.setenv("AUTH_SECRET", "test-secret")


def test_occupancy_event_carries_channel_targets():
    event = occupancy_event(SERVICE_ID, ORGANIZER_ID)
    assert event == {
        "serviceId": SERVICE_ID,
        "organizerId": ORGANIZER_ID,
    }


def test_occupancy_event_refused_for_demo_organizer():
    assert occupancy_event(SERVICE_ID, DEMO_ORGANIZER_ID) is None


@respx.mock
async def test_trigger_revalidation_sends_tags_and_occupancy(monkeypatch):
    route = respx.post(REVALIDATE_URL).mock(return_value=httpx.Response(200))
    _env(monkeypatch)
    event = occupancy_event(SERVICE_ID, ORGANIZER_ID)
    await trigger_revalidation(["public-service:x", "public-organizer:y"], occupancy=event)
    assert route.call_count == 1
    body = json.loads(route.calls.last.request.content)
    assert body["tags"] == ["public-organizer:y", "public-service:x"]
    assert body["occupancy"] == {"serviceId": SERVICE_ID, "organizerId": ORGANIZER_ID}


@respx.mock
async def test_trigger_revalidation_omits_absent_occupancy(monkeypatch):
    route = respx.post(REVALIDATE_URL).mock(return_value=httpx.Response(200))
    _env(monkeypatch)
    await trigger_revalidation(["public-sitemap"])
    body = json.loads(route.calls.last.request.content)
    assert "occupancy" not in body


@respx.mock
async def test_trigger_revalidation_prefers_internal_app_url(monkeypatch):
    # Inside compose the public APP_URL (localhost) is unreachable from
    # the api container — INTERNAL_APP_URL carries the service DNS name.
    route = respx.post("http://web:3000/api/internal/revalidate").mock(
        return_value=httpx.Response(200)
    )
    _env(monkeypatch)
    monkeypatch.setenv("INTERNAL_APP_URL", "http://web:3000")
    await trigger_revalidation(["public-sitemap"])
    assert route.call_count == 1


@respx.mock
async def test_trigger_revalidation_absorbs_errors(monkeypatch):
    respx.post(REVALIDATE_URL).mock(return_value=httpx.Response(500))
    _env(monkeypatch)
    await trigger_revalidation(
        ["public-sitemap"],
        occupancy={"serviceId": SERVICE_ID, "organizerId": ORGANIZER_ID},
    )

    respx.post(REVALIDATE_URL).mock(side_effect=httpx.ConnectError("down"))
    await trigger_revalidation(["public-sitemap"])  # must not raise
