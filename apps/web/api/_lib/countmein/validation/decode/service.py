"""Service input decoders — the patch decoder validates the merge-patch
document itself (a patch touching only one side of the options/mode pair
is rejected, parity with the Zod superRefine); the merged-state decoder
the PATCH handler runs over current+patch additionally enforces
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
