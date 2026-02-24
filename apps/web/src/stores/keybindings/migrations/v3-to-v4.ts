import { getDefaultShortcuts } from "@/lib/actions";
import type { TActionWithOptionalArgs } from "@/lib/actions";
import type { KeybindingConfig, ShortcutKey } from "@/types/keybinding";

interface V3State {
	keybindings: KeybindingConfig;
	isCustomized: boolean;
}

export function v3ToV4({ state }: { state: unknown }): unknown {
	const v3 = state as V3State;
	const migrated: KeybindingConfig = { ...(v3?.keybindings ?? {}) };
	const defaults = getDefaultShortcuts();

	const alreadyBoundActions = new Set<TActionWithOptionalArgs>(
		Object.values(migrated).filter(Boolean) as TActionWithOptionalArgs[],
	);

	for (const [shortcut, action] of Object.entries(defaults) as Array<
		[ShortcutKey, TActionWithOptionalArgs]
	>) {
		if (migrated[shortcut]) {
			continue;
		}
		if (alreadyBoundActions.has(action)) {
			continue;
		}
		migrated[shortcut] = action;
		alreadyBoundActions.add(action);
	}

	return { ...v3, keybindings: migrated };
}

