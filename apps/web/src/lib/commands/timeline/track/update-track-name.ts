import { Command } from "@/lib/commands/base-command";
import type { TimelineTrack } from "@/types/timeline";
import { EditorCore } from "@/core";

export class UpdateTrackNameCommand extends Command {
	private savedState: TimelineTrack[] | null = null;

	constructor(
		private trackId: string,
		private nextName: string,
	) {
		super();
	}

	execute(): void {
		const editor = EditorCore.getInstance();
		this.savedState = editor.timeline.getTracks();

		const trimmedName = this.nextName.trim();
		if (!trimmedName) {
			return;
		}

		const updatedTracks = this.savedState.map((track) =>
			track.id === this.trackId ? { ...track, name: trimmedName } : track,
		);
		editor.timeline.updateTracks(updatedTracks);
	}

	undo(): void {
		if (!this.savedState) return;
		const editor = EditorCore.getInstance();
		editor.timeline.updateTracks(this.savedState);
	}
}
