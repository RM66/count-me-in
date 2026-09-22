// Package routes holds the route logic for every API endpoint. The
// generated router (pkg/api, from the OpenAPI spec) is the single entry
// point for both the Vercel function (api/entry/index.go) and the local dev
// server (cmd/dev): it matches method+path, forwards {id}/{queue} and bound
// query params, and wraps every call in httpx.Recover. The handlers here
// therefore carry no method switches or path parsing of their own.
package routes
