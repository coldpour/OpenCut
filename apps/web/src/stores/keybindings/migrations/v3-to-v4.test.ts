import { describe, expect, test } from "bun:test";
import { v3ToV4 } from "./v3-to-v4";

describe("v3ToV4 keybindings migration", () => {
	test("adds missing default bindings for new actions without overwriting custom bindings", () => {
		const state = {
			keybindings: {
				space: "toggle-play",
				"alt+right": "seek-forward",
			},
			isCustomized: true,
		};

		const migrated = v3ToV4({ state }) as {
			keybindings: Record<string, string>;
			isCustomized: boolean;
		};

		expect(migrated.keybindings["alt+right"]).toBe("seek-forward");
		expect(migrated.keybindings["alt+left"]).toBe("nudge-selected-backward-fine");
		expect(migrated.keybindings["alt+shift+right"]).toBe(
			"nudge-selected-forward-coarse",
		);
		expect(migrated.keybindings["alt+shift+left"]).toBe(
			"nudge-selected-backward-coarse",
		);
		expect(migrated.keybindings.m).toBe("toggle-bookmark");
	});
});

