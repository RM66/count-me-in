package validation

import (
	"encoding/json"
	"fmt"
	"sync"

	gen "countmein/pkg/api/gen"

	"github.com/getkin/kin-openapi/openapi3"
)

// Spec-driven validation (ADR-016, Phase 3): the embedded OpenAPI document
// (go:embed in pkg/api/gen, rendered from the same Zod registry as the
// committed spec) is the authority for everything JSON Schema can say —
// types, bounds, enums, patterns, required, nullability. This file is the
// single kin-openapi → {formErrors, fieldErrors} adapter that replaced the
// fourteen generated parsers.
//
// kin-openapi's VisitJSON returns only the *first* failing check, but the
// API envelope collects one message per field (z.flattenError parity, and
// the vectors pin whole key sets). validateBody therefore drives the
// top-level object itself: required keys and each present property are
// validated individually, so every invalid field is reported.
//
// TODO(cold-start): kin-openapi parses the embedded spec at first use
// (tens of ms on a Vercel cold start). Measure against the +50ms budget
// from ADR-016 on the first production deploy; fallback is ogen with
// static validation (see migration plan §7 risk 1).

var (
	specOnce    sync.Once
	specSchemas map[string]*openapi3.Schema
	specErr     error
)

// specSchema loads the embedded document once and returns the named
// component schema. Failing to load is a programming error (the spec is
// generated and committed); callers treat a nil result as "cannot validate".
func specSchema(name string) *openapi3.Schema {
	specOnce.Do(func() {
		doc, err := gen.GetSwagger()
		if err != nil {
			specErr = err
			return
		}
		specSchemas = make(map[string]*openapi3.Schema, len(doc.Components.Schemas))
		for id, ref := range doc.Components.Schemas {
			specSchemas[id] = ref.Value
		}
	})
	if specErr != nil {
		return nil
	}
	return specSchemas[name]
}

// validateBody validates a decoded request body against the named component
// schema and collects every issue, keyed like z.flattenError's fieldErrors:
// missing required keys and per-property failures under the property name,
// everything else as form errors. Unknown keys are ignored — Zod strips
// them, and the spec deliberately carries no additionalProperties:false.
func validateBody(schemaName string, m map[string]json.RawMessage) *Errors {
	schema := specSchema(schemaName)
	if schema == nil {
		// Unreachable while the spec and the decoders ship together; a nil
		// here would mean validation was silently skipped, so fail loudly.
		return FormErrors(fmt.Sprintf("unknown schema %q", schemaName))
	}
	e := NewErrors()
	for _, name := range schema.Required {
		if _, ok := m[name]; !ok {
			e.Add(name, "Required")
		}
	}
	for key, raw := range m {
		prop, ok := schema.Properties[key]
		if !ok || prop == nil || prop.Value == nil {
			continue // unknown key: stripped, like Zod
		}
		var value any
		if err := json.Unmarshal(raw, &value); err != nil {
			e.Add(key, "Invalid JSON")
			continue
		}
		if err := prop.Value.VisitJSON(value); err != nil {
			e.Add(key, schemaErrReason(err))
		}
	}
	return e.Finish()
}

// schemaErrReason flattens a kin-openapi error into one line for the
// envelope. *openapi3.SchemaError carries the human-readable Reason; a
// MultiError (nested aggregates) is joined.
func schemaErrReason(err error) string {
	switch t := err.(type) {
	case *openapi3.SchemaError:
		if t.Reason != "" {
			return t.Reason
		}
		return t.Error()
	case openapi3.MultiError:
		msgs := make([]string, 0, len(t))
		for _, sub := range t {
			msgs = append(msgs, schemaErrReason(sub))
		}
		return joinMessages(msgs)
	default:
		return err.Error()
	}
}

func joinMessages(msgs []string) string {
	out := ""
	for i, m := range msgs {
		if i > 0 {
			out += "; "
		}
		out += m
	}
	return out
}
