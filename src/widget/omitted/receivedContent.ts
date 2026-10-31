import wrapUnsupportedMessagePlate from '@components/chat/bubbleParts/unsupportedMessagePlate';

// The widget's render boundary normalizes these messages before upstream can
// enter their special branches. Retain a nonempty fallback for direct consumers.
export default wrapUnsupportedMessagePlate;
export const StarGiftBubble = wrapUnsupportedMessagePlate;
export const UniqueStarGiftWebPageBox = wrapUnsupportedMessagePlate;
export const PremiumGiftBubble = wrapUnsupportedMessagePlate;
export const StarGiftOfferBubble = wrapUnsupportedMessagePlate;
export const StarGiftOfferReplyMarkup = wrapUnsupportedMessagePlate;
export const SuggestBirthdayBubble = wrapUnsupportedMessagePlate;
export const NoForwardsRequestContent = wrapUnsupportedMessagePlate;
export const NoForwardsRequestReplyMarkup = wrapUnsupportedMessagePlate;
export const DelimiterWithText = wrapUnsupportedMessagePlate;
export const showStarGiftOfferButtons = () => false;
export const getGiftAssetName = () => '';
export const onGiveawayClick = () => {};
