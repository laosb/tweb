import wrapUnsupportedMessagePlate from '@components/chat/bubbleParts/unsupportedMessagePlate';

export const getConferenceCallParticipants = (): PeerId[] => [];
export default function wrapCallBubble() {
  return {element: wrapUnsupportedMessagePlate()};
}
