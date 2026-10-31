import type {WrapGeoResult} from '@components/wrappers/geo';
import wrapUnsupportedMessagePlate from '@components/chat/bubbleParts/unsupportedMessagePlate';

// Rich-message maps use their own map block and confirmation, both retained.
export default function wrapGeo({attachmentDiv}: {attachmentDiv: HTMLElement}): WrapGeoResult {
  attachmentDiv.append(wrapUnsupportedMessagePlate());
  return {canHaveTail: false, mediaRequiresMessageDiv: false, isVenue: false, isLive: false, isLiveExpired: false};
}
