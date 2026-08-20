/**
 * CountMeIn house rules, as a flat-config plugin.
 *
 * `next.js` registers this plugin with every rule `off`; apps opt in per
 * directory, because a repo-wide `error` would punish the not-yet-migrated
 * surfaces (cabinet, marketing) for the phased rollout in ADR-011.
 */

import noUntranslatedStrings from "./src/no-untranslated-strings.js";

export default {
  rules: {
    "no-untranslated-strings": noUntranslatedStrings,
  },
};
