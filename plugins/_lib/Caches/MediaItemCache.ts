import { store } from "@neptune";
import type { TrackItem, MediaItem as TidalMediaItem, ItemId, VideoItem } from "neptune-types/tidal";
import { interceptPromise } from "../intercept/interceptPromise";
import type { PlaybackContext } from "../AudioQualityTypes";
import getPlaybackControl from "../getPlaybackControl";

import { libTrace } from "../trace";

export type MediaItem = TrackItem | VideoItem;
export class MediaItemCache {
	private static readonly _cache: Record<ItemId, MediaItem> = {};
	public static current(playbackContext?: PlaybackContext) {
		playbackContext ??= getPlaybackControl()?.playbackContext;
		if (playbackContext?.actualProductId === undefined) return undefined;
		return this.ensure(playbackContext.actualProductId);
	}
	public static async ensureTrack(itemId?: ItemId) {
		const mediaItem = await this.ensure(itemId);
		if (mediaItem?.contentType === "track") return mediaItem;
		return undefined;
	}
	public static async ensureVideo(itemId?: ItemId) {
		const mediaItem = await this.ensure(itemId);
		if (mediaItem?.contentType === "video") return mediaItem;
		return undefined;
	}
	public static async ensure(itemId?: ItemId) {
		if (itemId === undefined) return undefined;

		let mediaItem = this._cache[itemId];
		if (mediaItem !== undefined) return mediaItem;

		const mediaItems: Record<number, TidalMediaItem> = store.getState().content.mediaItems;
		for (const itemId in mediaItems) {
			const item = mediaItems[itemId]?.item;
			this._cache[itemId] = item;
		}

		if (this._cache[itemId] === undefined) {
			const currentPage = window.location.pathname;
			
			const successfullyLoadedTrack = await interceptPromise(() => neptune.actions.router.push(<any>`/track/${itemId}`), ["page/IS_DONE_LOADING"], [])
				.then(() => true)
				.catch(libTrace.warn.withContext(`TrackItemCache.ensure failed to load track ${itemId}`));
			// If we fail to load the track, maybe its a video, try that instead as a last ditch attempt
			// TODO: There is never a video for me and the error is a bit annoying
			// if (!loadedTrack) {
			// 	await interceptPromise(() => neptune.actions.router.replace(<any>`/video/${itemId}`), ["page/IS_DONE_LOADING"], []).catch(
			// 		libTrace.warn.withContext(`TrackItemCache.ensure failed to load video ${itemId}`)
			// 	);
			// }

			// We just navigate back to the pevious page so the scroll is restored
			if (successfullyLoadedTrack) {
				neptune.actions.routerGoBack();
			}

			// When the load didn't succeed (not really sure if it is fast enough) then we just do a replace
			// FIXME: I think it's too fast
			if (window.location.pathname !== currentPage) {
				neptune.actions.router.replace(<any>currentPage);
			}

			const mediaItems: Record<number, TidalMediaItem> = store.getState().content.mediaItems;
			const trackItem = mediaItems[+itemId]?.item;
			this._cache[itemId] = trackItem;
		}

		return this._cache[itemId];
	}
}
