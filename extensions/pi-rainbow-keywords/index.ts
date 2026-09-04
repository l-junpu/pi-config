/**
 * Rainbow Keywords - shimmers "subagent"/"subagents" in the editor
 *
 * Thin usage example of the reusable keyword-shimmer template. See
 * keyword-shimmer.ts to reuse this from other extensions or customize colors.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installKeywordShimmer } from "./keyword-shimmer.ts";

export default function (pi: ExtensionAPI) {
	installKeywordShimmer(pi, {
		pattern: /subagents?/gi,
		palette: { low: "dim", mid: "muted", high: "accent", bold: true },
	});
}
