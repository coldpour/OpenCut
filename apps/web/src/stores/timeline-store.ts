/**
 * UI state for the timeline
 * For core logic, use EditorCore instead.
 */

import { create } from "zustand";
import type { ClipboardItem } from "@/types/timeline";

interface TimelineStore {
	snappingEnabled: boolean;
	toggleSnapping: () => void;
	rippleEditingEnabled: boolean;
	toggleRippleEditing: () => void;
	showBeatMarkers: boolean;
	toggleBeatMarkers: () => void;
	clipboard: {
		items: ClipboardItem[];
	} | null;
	setClipboard: (
		clipboard: {
			items: ClipboardItem[];
		} | null,
	) => void;
}

export const useTimelineStore = create<TimelineStore>((set) => ({
	snappingEnabled: true,

	toggleSnapping: () => {
		set((state) => ({ snappingEnabled: !state.snappingEnabled }));
	},

	rippleEditingEnabled: false,

	toggleRippleEditing: () => {
		set((state) => ({
			rippleEditingEnabled: !state.rippleEditingEnabled,
		}));
	},

	showBeatMarkers: true,

	toggleBeatMarkers: () => {
		set((state) => ({ showBeatMarkers: !state.showBeatMarkers }));
	},

	clipboard: null,

	setClipboard: (clipboard) => {
		set({ clipboard });
	},
}));
