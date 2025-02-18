import { MediaItemCache } from "@inrixia/lib/Caches/MediaItemCache";
import { actions, intercept, store } from "@neptune";
import { debounce } from "@inrixia/lib/debounce";

import { Tracer } from "@inrixia/lib/trace";
const trace = Tracer("[RealMAX]");

import { chunkArray } from "@inrixia/helpers/object";

import safeUnload from "@inrixia/lib/safeUnload";
import { interceptPromise } from "@inrixia/lib/intercept/interceptPromise";
import { MaxTrack } from "@inrixia/lib/MaxTrack";
import { ContextMenu } from "@inrixia/lib/ContextMenu";
import { AlbumCache } from "@inrixia/lib/Caches/AlbumCache";
import { settings } from "./Settings";

export { Settings } from "./Settings";

const unloadIntercept = intercept(
	"playbackControls/MEDIA_PRODUCT_TRANSITION",
	debounce(async () => {
		const { elements, currentIndex } = store.getState().playQueue;
		const queueId = elements[currentIndex]?.mediaItemId;
		const nextQueueId = elements[currentIndex + 1]?.mediaItemId;

		const maxItem = await MaxTrack.getMaxTrack(queueId);
		if (maxItem === false) return;
		if (maxItem.id !== undefined && nextQueueId !== maxItem.id) {
			if (settings.displayInfoPopups) trace.msg.log(`Found Max quality for ${maxItem.title}! Adding to queue and skipping...`);
			actions.playQueue.addNext({ mediaItemIds: [maxItem.id], context: { type: "user" } });
			actions.playQueue.moveNext();
		}
		// Preload next two
		MaxTrack.getMaxTrack(elements[currentIndex + 1]?.mediaItemId);
		MaxTrack.getMaxTrack(elements[currentIndex + 2]?.mediaItemId);
	}, 125)
);

ContextMenu.onOpen(async (contextSource, contextMenu, trackItems) => {
	document.getElementById("realMax-button")?.remove();
	if (trackItems.length === 0 || !settings.displayMaxContextButton) return;

	let sourceName = trackItems[0].title;
	if (contextSource.type === "PLAYLIST") sourceName = store.getState().content.playlists.find((playlist) => playlist.uuid === contextSource.playlistId)?.title ?? sourceName;
	else if (contextSource.type === "ALBUM") sourceName = (await AlbumCache.get(+contextSource.albumId))?.title ?? sourceName;
	sourceName = `${sourceName} - RealMAX`;

	const maxButton = document.createElement("button");
	maxButton.type = "button";
	maxButton.role = "menuitem";
	maxButton.textContent = trackItems.length > 1 ? `RealMAX - Process ${trackItems.length} tracks` : "RealMAX - Process track";
	maxButton.id = "realMax-button";
	maxButton.className = "context-button"; // Set class name for styling
	contextMenu.appendChild(maxButton);
	maxButton.addEventListener("click", async () => {
		maxButton.remove();
		const trackIds: number[] = [];
		let maxIdsFound = 0;
		for (const index in trackItems) {
			const trackItem = trackItems[index];
			const trackId = trackItem.id!;
			if (trackId === undefined) continue;
			const maxItem = await MaxTrack[settings.considerNewestRelease ? "getLatestMaxTrack" : "getMaxTrack"](trackId).catch(
				trace.msg.err.withContext(`Skipping adding ${trackItem.title} to ${sourceName}`)
			);
			if (maxItem === false || maxItem === undefined) continue;
			if (maxItem?.id !== undefined) {
				if ((await MediaItemCache.ensure(trackId)) !== undefined) {
					trace.msg.log(`Found Max quality for ${maxItem.title} in ${sourceName}! ${index}/${trackItems.length - 1} done.`);
					trackIds.push(+maxItem.id);
					maxIdsFound++;
					continue;
				}
				trace.msg.log(`Found Max quality for ${maxItem.title} in ${sourceName}, but track is unavailable... Skipping! ${index}/${trackItems.length - 1} done.`);
				trackIds.push(trackId);
				continue;
			}
			trace.msg.log(`${sourceName} - ${index}/${trackItems.length - 1} done. `);
			trackIds.push(trackId);
		}
		const [{ playlist }] = await interceptPromise(
			() =>
				actions.folders.createPlaylist({
					description: "Automatically generated by RealMAX",
					folderId: "root",
					fromPlaylist: undefined,
					isPublic: false,
					title: sourceName,
					// @ts-expect-error This works lol
					ids: trackIds.length > 450 ? undefined : trackIds,
				}),
			["content/LOAD_PLAYLIST_SUCCESS"],
			["content/LOAD_PLAYLIST_FAIL"]
		);
		if (trackIds.length > 500) {
			for (const trackIdsChunk of chunkArray(trackIds, 450)) {
				await interceptPromise(
					() =>
						actions.content.addMediaItemsToPlaylist({
							addToIndex: -1,
							mediaItemIdsToAdd: trackIdsChunk,
							onDupes: "ADD",
							playlistUUID: playlist.uuid!,
						}),
					["content/ADD_MEDIA_ITEMS_TO_PLAYLIST_SUCCESS"],
					["content/ADD_MEDIA_ITEMS_TO_PLAYLIST_FAIL"]
				);
			}
		}
		if (playlist?.uuid === undefined) {
			return trace.msg.err(`Failed to create playlist "${sourceName}"`);
		}
		trace.msg.err(`Successfully created RealMAX playlist "${sourceName}" - Found ${maxIdsFound} RealMAX replacements!`);
	});
});

export const onUnload = () => {
	unloadIntercept();
	safeUnload();
};
