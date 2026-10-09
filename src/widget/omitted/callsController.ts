import EventListenerBase from '@helpers/eventListenerBase';

// Calls are off in the widget. This stands in for each call controller the chat page
// starts and listens to; it never holds, receives or starts a call.
class NoCallsController extends EventListenerBase<any> {
  public currentCall: undefined;
  public groupCall: undefined;
  public construct() {}
}

export class RtmpCallInstance {}
export default new NoCallsController();
