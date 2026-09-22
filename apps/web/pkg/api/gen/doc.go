// Package api holds the oapi-codegen artifacts derived from the
// OpenAPI spec at the app root (../../../openapi.yaml, rendered by
// `bun run generate:openapi` from the Zod wire registry). Everything
// here is generated — hand-written code lives in the parent package
// (pkg/api).
//
// Regenerate with `go generate ./pkg/api/...` after changing the spec.
package api

//go:generate go run github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@v2.8.0 --config cfg.yaml ../../../openapi.yaml
//go:generate go run github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@v2.8.0 --config cfg-server.yaml ../../../openapi.yaml
//go:generate go run github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@v2.8.0 --config cfg-spec.yaml ../../../openapi.yaml
