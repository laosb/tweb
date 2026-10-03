import type {InputFileLocation, Message, Update, Updates, UpdatesState, User} from '@layer';
import {randomLong} from '@helpers/random';
import type {WidgetConfig} from '@/widget/config';
import type {WidgetRPC} from '@/widget/transport';
import type {WidgetSession} from '@/widget/session';

export const MAX_FILE_SIZE = 20 * 1024 * 1024;
const PART_SIZE = 256 * 1024;
const PAGE_SIZE = 50;

export type WidgetMessage = {
  id: number,
  text: string,
  outgoing: boolean,
  date: number,
  attachment?: {name: string, photo: boolean, size: number},
  unsupported?: boolean
};

function mediaFile(message: Message.message) {
  const media = message.media;
  if(media?._ === 'messageMediaPhoto' && !media.ttl_seconds && media.photo?._ === 'photo') {
    const photo = media.photo;
    const sizes = photo.sizes.filter((size) => size._ === 'photoSize' || size._ === 'photoSizeProgressive');
    const size = sizes[sizes.length - 1];
    if(!size) return;
    return {
      location: {_: 'inputPhotoFileLocation', id: photo.id, access_hash: photo.access_hash,
        file_reference: photo.file_reference, thumb_size: size.type} as InputFileLocation,
      name: 'Photo.jpg', photo: true, mime: 'image/jpeg',
      size: size._ === 'photoSize' ? size.size : size.sizes[size.sizes.length - 1]
    };
  }
  if(media?._ !== 'messageMediaDocument' || media.ttl_seconds || media.document?._ !== 'document') return;
  const doc = media.document;
  if(doc.mime_type === 'image/gif' || doc.attributes.some(({_}) =>
    ['documentAttributeSticker', 'documentAttributeCustomEmoji', 'documentAttributeAnimated'].includes(_))) return;
  const filename = doc.attributes.find((attribute) => attribute._ === 'documentAttributeFilename');
  return {
    location: {_: 'inputDocumentFileLocation', id: doc.id, access_hash: doc.access_hash,
      file_reference: doc.file_reference, thumb_size: ''} as InputFileLocation,
    name: filename?.file_name || 'Attachment', photo: false, mime: 'application/octet-stream', size: +doc.size
  };
}

export async function validateAttachment(file: File) {
  if(!file.size || file.size > MAX_FILE_SIZE) throw new Error('WIDGET_FILE_SIZE');
  const bytes = new Uint8Array(await file.slice(0, 6).arrayBuffer());
  if(file.type === 'image/gif' || /\.(gif|tgs|vcf|vcard)$/i.test(file.name) ||
    String.fromCharCode(...bytes).startsWith('GIF8') || /(?:vcard|tgsticker)/i.test(file.type)) {
    throw new Error('WIDGET_FILE_TYPE');
  }
}

/** The sole domain API exposed to the view. Every read/send is bound to the
 * support peer returned by this DC; the view cannot supply another peer. */
export class WidgetManager implements WidgetSession {
  supportName = 'Support';
  onChange?: () => void;
  private support?: User.user;
  private self?: User.user;
  private messages = new Map<number, Message.message>();
  private closed = false;
  private updates?: UpdatesState;
  private readMax = 0;

  constructor(private rpc: WidgetRPC, private config: WidgetConfig) {
    rpc.onUpdate = (update) => this.processUpdates(update as Updates);
  }

  async authenticate(token: string) {
    const auth = await this.rpc.call('auth.importBotAuthorization', {
      flags: 0, api_id: this.config.apiId, api_hash: this.config.apiHash, bot_auth_token: token
    });
    if(auth._ !== 'auth.authorization' || auth.user._ !== 'user' || auth.user.pFlags?.bot) {
      throw new Error('WIDGET_MANAGED_ACCOUNT_REQUIRED');
    }
    this.self = auth.user;
    const support = await this.rpc.call('help.getSupport', {});
    if(support.user._ !== 'user' || support.user.pFlags?.deleted || !support.user.access_hash || support.user.id === this.self.id) {
      throw new Error('SUPPORT_UNAVAILABLE');
    }
    this.support = support.user;
    this.supportName = [support.user.first_name, support.user.last_name].filter(Boolean).join(' ') || 'Support';
    // Subscribe to updates only after token authorization and peer discovery.
    this.updates = await this.rpc.call('updates.getState', {});
  }

  private get peer() {
    if(this.closed || !this.support) throw new Error('WIDGET_CLOSED');
    return {_: 'inputPeerUser' as const, user_id: this.support.id, access_hash: this.support.access_hash};
  }

  private belongs(message: Message.message) {
    return message.peer_id._ === 'peerUser' &&
      (message.peer_id.user_id === this.support?.id ||
        (message.peer_id.user_id === this.self?.id && message.from_id?._ === 'peerUser' && message.from_id.user_id === this.support?.id));
  }

  private processUpdates(updates: Updates | Update | {_: 'new_session_created'}) {
    if(this.closed || !this.support) return;
    if(updates._ === 'updates' || updates._ === 'updatesCombined') {
      updates.updates.forEach((update) => this.processUpdates(update));
    } else if(updates._ === 'updateShort') {
      this.processUpdates(updates.update);
    } else if(updates._ === 'updateDeleteMessages') {
      updates.messages.forEach((id) => this.messages.delete(id));
    } else if(updates._ === 'updateNewMessage' || updates._ === 'updateEditMessage') {
      const message = updates.message;
      if(message._ === 'message' && this.belongs(message)) this.messages.set(message.id, message);
      else return;
    }
    this.onChange?.();
  }

  get view(): WidgetMessage[] {
    return [...this.messages.values()].sort((a, b) => a.id - b.id).map((message) => {
      const file = mediaFile(message);
      return {
        id: message.id, text: message.message, outgoing: !!message.pFlags?.out, date: message.date,
        attachment: file && {name: file.name, photo: file.photo, size: file.size},
        unsupported: !file && !!message.media && message.media._ !== 'messageMediaEmpty' && message.media._ !== 'messageMediaWebPage'
      };
    });
  }

  async history(before = 0): Promise<boolean> {
    const result = await this.rpc.call('messages.getHistory', {
      peer: this.peer, offset_id: before, offset_date: 0, add_offset: 0,
      limit: PAGE_SIZE, max_id: 0, min_id: 0, hash: '0'
    });
    if(this.closed) return false;
    if(result._ === 'messages.messagesNotModified') return false;
    const messages = result.messages.filter((message): message is Message.message => message._ === 'message' && this.belongs(message));
    // Reconcile the fetched range, including edits and deletions after reconnect.
    const floor = result.messages.length === PAGE_SIZE ? Math.min(...result.messages.map(({id}) => id)) : 0;
    for(const id of this.messages.keys()) if(id >= floor && (!before || id < before)) this.messages.delete(id);
    messages.forEach((message) => this.messages.set(message.id, message));
    return result.messages.length === PAGE_SIZE;
  }

  async markRead() {
    const max = Math.max(0, ...this.messages.keys());
    if(max > this.readMax) {
      await this.rpc.call('messages.readHistory', {peer: this.peer, max_id: max});
      this.readMax = max;
    }
  }

  async synchronize() {
    // Live pushes give immediate feedback; difference replay closes reconnect
    // gaps and carries edits/deletions even for already-loaded older messages.
    for(let page = 0; page < 10 && !this.closed; ++page) {
      const state = this.updates;
      const diff = await this.rpc.call('updates.getDifference', {
        pts: state.pts, date: state.date, qts: state.qts, pts_limit: 100, pts_total_limit: 1000
      });
      if(this.closed) return;
      if(diff._ === 'updates.differenceEmpty') {
        this.updates = {...state, date: diff.date, seq: diff.seq};
        return;
      }
      if(diff._ === 'updates.differenceTooLong') {
        this.updates = await this.rpc.call('updates.getState', {});
        this.messages.clear();
        await this.history();
        return;
      }
      for(const message of diff.new_messages) {
        if(message._ === 'message' && this.belongs(message)) this.messages.set(message.id, message);
      }
      diff.other_updates.forEach((update) => this.processUpdates(update));
      this.updates = diff._ === 'updates.differenceSlice' ? diff.intermediate_state : diff.state;
      if(diff._ !== 'updates.differenceSlice') return;
    }
  }

  async send(text: string, randomId: string, file?: File) {
    const peer = this.peer;
    if(text.length > (file ? 1024 : 4096) || (!text.trim() && !file)) throw new Error('WIDGET_MESSAGE_INVALID');
    let updates: Updates;
    if(file) {
      await validateAttachment(file);
      const fileId = randomLong(), parts = Math.ceil(file.size / PART_SIZE);
      for(let part = 0; part < parts; ++part) {
        if(this.closed) throw new Error('WIDGET_CLOSED');
        const bytes = new Uint8Array(await file.slice(part * PART_SIZE, (part + 1) * PART_SIZE).arrayBuffer());
        if(!await this.rpc.call('upload.saveBigFilePart', {file_id: fileId, file_part: part, file_total_parts: parts, bytes})) {
          throw new Error('WIDGET_UPLOAD_FAILED');
        }
      }
      const input = {_: 'inputFileBig' as const, id: fileId, parts, name: file.name};
      const photo = ['image/jpeg', 'image/png'].includes(file.type);
      updates = await this.rpc.call('messages.sendMedia', {
        peer: this.peer, message: text, random_id: randomId,
        media: photo ? {_: 'inputMediaUploadedPhoto', file: input, pFlags: {}} : {
          _: 'inputMediaUploadedDocument', file: input, pFlags: {force_file: true},
          mime_type: file.type || 'application/octet-stream',
          attributes: [{_: 'documentAttributeFilename', file_name: file.name}]
        }
      });
    } else {
      updates = await this.rpc.call('messages.sendMessage', {peer, message: text, random_id: randomId, no_webpage: true});
    }
    this.processUpdates(updates);
  }

  async download(id: number): Promise<{blob: Blob, name: string, photo: boolean}> {
    const message = this.messages.get(id);
    if(!message) throw new Error('WIDGET_ATTACHMENT_UNAVAILABLE');
    const file = mediaFile(message);
    if(!file || !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > MAX_FILE_SIZE) throw new Error('WIDGET_FILE_SIZE');
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    for(let offset = 0; offset < file.size; offset += PART_SIZE) {
      if(this.closed) throw new Error('WIDGET_CLOSED');
      const result = await this.rpc.call('upload.getFile', {location: file.location, offset, limit: PART_SIZE});
      if(result._ !== 'upload.file' || result.bytes.length !== Math.min(PART_SIZE, file.size - offset)) {
        throw new Error('WIDGET_ATTACHMENT_UNAVAILABLE');
      }
      chunks.push(new Uint8Array(result.bytes));
    }
    return {blob: new Blob(chunks, {type: file.mime}), name: file.name, photo: file.photo};
  }

  async logout() {
    try { await this.rpc.call('auth.logOut', {}); }
    catch(error) { if((error as ApiError)?.code !== 401) throw error; }
  }

  destroy() {
    this.closed = true;
    this.onChange = undefined;
    this.messages.clear();
    this.rpc.destroy();
  }
}
