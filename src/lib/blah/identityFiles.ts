import createDownloadAnchor from '@helpers/dom/createDownloadAnchor';
import {ObjectURLScope} from '@helpers/objectUrl';

export function exportIdentityFile(name: string, bytes: BlobPart, type = 'application/cbor') {
  const urls = new ObjectURLScope();
  const url = urls.create(new Blob([bytes], {type}));
  createDownloadAnchor(url, name, () => setTimeout(() => urls.dispose(), 30_000));
}
