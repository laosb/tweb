import ChatInput from '@components/chat/input';

export function restrictRecipients() {
  const input = ChatInput.prototype as any;
  const targets = [[input, 'constructReplyElements'], [input, 'changeReplyRecipient'], [input, 'createReplyPicker']];
  for(const [object, key] of targets) {
    if(typeof(object[key]) !== 'function') throw new Error('WIDGET_RESTRICTION_TARGET_MISSING: ' + key);
  }
  const construct = input.constructReplyElements;
  input.constructReplyElements = function() {
    const result = construct.call(this);
    const item = this.replyElements.replyInAnother;
    if(!item?.element) throw new Error('WIDGET_RESTRICTION_TARGET_MISSING: replyInAnother.element');
    item.element.remove();
    return result;
  };
  input.changeReplyRecipient = function() {
    this.helperWaitingReply = false;
    return Promise.resolve();
  };
  input.createReplyPicker = () => Promise.resolve();
}
