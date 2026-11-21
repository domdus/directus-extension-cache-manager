import { formatDurationLabel, sameDuration } from './duration';
import type { CacheValues } from './settings';

/** The unsaved changes in plain words, one entry per change (also the count in the save bar). */
export function pendingChanges(draft: CacheValues, effective: CacheValues | null | undefined): string[] {
	if (!effective) return [];
	const list: string[] = [];
	const onOff = (value: boolean) => (value ? 'on' : 'off');
	if (draft.autoPurge !== effective.autoPurge) list.push(`clear the cache when content changes: ${onOff(draft.autoPurge)}`);
	if (draft.skipAllowed !== effective.skipAllowed) list.push(`allow apps to skip the cache: ${onOff(draft.skipAllowed)}`);
	if (!sameDuration(draft.ttl, effective.ttl)) {
		list.push(`keep answers in the cache for: ${draft.ttl ? formatDurationLabel(draft.ttl) : '(empty)'}`);
	}
	return list;
}

/** State text for the save button tooltip. */
export function saveBarText(count: number, ttlValid: boolean): { text: string; danger: boolean } {
	if (!ttlValid) return { text: 'Fix the cache lifetime to save', danger: true };
	if (!count) return { text: 'No unsaved changes', danger: false };
	return { text: count === 1 ? '1 unsaved change' : `${count} unsaved changes`, danger: false };
}
