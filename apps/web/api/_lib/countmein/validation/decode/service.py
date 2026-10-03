"""Service input decoders — the patch decoder validates the patch itself
(a patch touching only one side of the options/mode pair is rejected,
Zod parity); the merged-state decoder additionally enforces
mergedRequired (ADR-024 C2)."""

from __future__ import annotations

from ...contracts import models_gen as gen
from .core import decode_input, decode_merged


def decode_create_service_input(body: bytes) -> gen.CreateServiceInput:
    return decode_input(gen.CreateServiceInput, "CreateServiceInput", body)


def decode_update_service_input(body: bytes) -> gen.UpdateServiceInput:
    return decode_input(gen.UpdateServiceInput, "UpdateServiceInput", body)


def decode_merged_service_input(merged: bytes) -> gen.UpdateServiceInput:
    return decode_merged(gen.UpdateServiceInput, "UpdateServiceInput", merged)
