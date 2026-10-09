import type {PollMessageContentProps} from '@components/chat/bubbleParts/pollMessageContent/PollMessageContent';

// The widget has no polls: one a support agent sends shows only its question. The bubble
// sizes a poll to its content and pins the time to the bottom corner.
export function PollMessageContent(props: PollMessageContentProps) {
  const question = document.createElement('div');
  question.textContent = '📊 ' + props.poll.question.text;
  question.style.cssText = 'width: max-content; max-width: min(20rem, 70vw); padding: .375rem .75rem 1.5rem; white-space: pre-wrap; overflow-wrap: anywhere';
  return question;
}
