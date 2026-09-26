"""Application factory.

The public OpenAPI document is the Zod-rendered one (apps/web/openapi.yaml);
FastAPI never serves its own spec, hence openapi_url/docs/redoc are disabled.
Heavy optional dependencies (boto3, qstash) and engine/Redis clients are
lazy singletons created on first use — never at import time.
"""

from fastapi import FastAPI


def create_app() -> FastAPI:
    return FastAPI(openapi_url=None, docs_url=None, redoc_url=None)


app = create_app()
