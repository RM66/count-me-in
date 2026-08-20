/**
 * `no-untranslated-strings` — flags hardcoded user-visible copy.
 *
 * The app is localized (ADR-011): user-visible strings must come from
 * `useTranslations` / `getTranslations`, never from a literal. The rule catches
 * the shapes that slip through:
 *
 * - JSX text children (`<p>Hello</p>`)
 * - visible string props: `aria-label`, `aria-description`, `alt`, `placeholder`
 * - string literals rendered as JSX expressions (`<p>{'Hello'}</p>`)
 * - toast calls with a literal message (`toast.error('Hello')`)
 * - `ApiError` constructions with a literal message (client fallbacks)
 * - `NextResponse.json({ error: 'Hello' })` bodies (route-handler errors that
 *   the client renders verbatim)
 *
 * It deliberately does **not** flag plain `new Error('…')` — those are internal
 * errors, log lines and storage guards, not copy. Deliberately untranslated
 * internal messages stay outside the rule by construction.
 *
 * What is allowed without translation:
 *
 * - strings with no letters (digits, punctuation, emoji, whitespace) and
 *   single letters
 * - proper nouns that exist in every language: `CountMeIn`, `Telegram`
 *   (plus anything the config adds via `options.allowed`)
 *
 * The rule is registered by the shared `next.js` config as `off`; each app
 * enables it per directory. In `apps/web` it is on app-wide for
 * `src/**` TypeScript modules (tests and Storybook stories exempt).
 */

const DEFAULT_ALLOWED = ["CountMeIn", "Telegram"];

const VISIBLE_ATTRIBUTES = /^(aria-label|aria-description|alt|placeholder)$/;

/** True when the text may stay hardcoded (no letters, single letter, allowed proper noun). */
function isAllowed(text, allowed) {
  const trimmed = text.trim();
  if (trimmed.length === 0) return true;
  // No letters at all — digits, emoji, punctuation, separators like "·".
  if (!/[A-Za-zА-Яа-яЁё]/.test(trimmed)) return true;
  // A single letter — e.g. an avatar fallback rendered inline.
  if (/^[A-Za-zА-Яа-яЁё]$/.test(trimmed)) return true;
  return allowed.has(trimmed);
}

/** True when the argument is a plain string literal and `check` should run. */
function literalArg(node) {
  if (!node) return null;
  if (node.type === "Literal" && typeof node.value === "string") return node;
  // Template literal without substitutions is as literal as a quoted string.
  if (
    node.type === "TemplateLiteral" &&
    node.expressions.length === 0 &&
    node.quasis.length === 1
  ) {
    return node.quasis[0];
  }
  return null;
}

export default {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow hardcoded user-visible strings (i18n, ADR-011).",
    },
    schema: [
      {
        type: "object",
        properties: {
          allowed: { type: "array", items: { type: "string" } },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      untranslated:
        'User-visible string "{{ text }}" must be translated via useTranslations / getTranslations (i18n, ADR-011).',
    },
  },

  create(context) {
    const allowed = new Set([...DEFAULT_ALLOWED, ...(context.options[0]?.allowed ?? [])]);

    function check(node, raw) {
      if (typeof raw !== "string" || isAllowed(raw, allowed)) return;
      context.report({
        node,
        messageId: "untranslated",
        data: { text: raw.trim() },
      });
    }

    return {
      JSXText(node) {
        check(node, node.value);
      },
      JSXAttribute(node) {
        if (!VISIBLE_ATTRIBUTES.test(node.name.name)) return;
        const value = node.value;
        if (value && value.type === "Literal" && typeof value.value === "string") {
          check(value, value.value);
        }
      },
      JSXExpressionContainer(node) {
        const expression = node.expression;
        if (expression.type === "Literal" && typeof expression.value === "string") {
          check(expression, expression.value);
        }
      },
      // toast.error('…') / toast.success('…') — copy shown in the sonner toasts;
      // NextResponse.json({ error: '…' }) — server copy rendered by the client.
      CallExpression(node) {
        const callee = node.callee;
        if (
          callee.type === "MemberExpression" &&
          callee.object.type === "Identifier" &&
          callee.property.type === "Identifier"
        ) {
          if (callee.object.name === "toast") {
            const arg = literalArg(node.arguments[0]);
            if (arg) check(arg, arg.value ?? "");
            return;
          }
          if (callee.object.name === "NextResponse" && callee.property.name === "json") {
            const body = node.arguments[0];
            if (body && body.type === "ObjectExpression") {
              const errorProp = body.properties.find(
                (prop) =>
                  prop.type === "Property" &&
                  prop.key.type === "Identifier" &&
                  prop.key.name === "error" &&
                  prop.value.type === "Literal" &&
                  typeof prop.value.value === "string",
              );
              if (errorProp) check(errorProp.value, errorProp.value.value);
            }
          }
        }
      },
      // new ApiError('…', …) — the client's own fallback copy.
      NewExpression(node) {
        if (node.callee.type !== "Identifier" || node.callee.name !== "ApiError") return;
        const arg = literalArg(node.arguments[0]);
        if (arg) check(arg, arg.value ?? "");
      },
    };
  },
};
