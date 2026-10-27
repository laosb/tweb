import {createServer} from 'node:http';
import {once} from 'node:events';
import {createHash} from 'node:crypto';

// Disposable S3 byte storage for the real DC. Authentication, upload parts,
// finalization, media metadata and downloads still go through its MTProto API.
export async function objectStorage() {
  const objects = new Map();
  const errors = [];
  const server = createServer(async(req, res) => {
    const url = new URL(req.url, 'http://localhost');
    url.searchParams.delete('x-id');
    const key = decodeURIComponent(url.pathname);
    if(req.method === 'PUT' && !url.search) {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const bytes = Buffer.concat(chunks);
      objects.set(key, {bytes, type: req.headers['content-type'] || 'application/octet-stream'});
      res.writeHead(200, {ETag: '"' + createHash('md5').update(bytes).digest('hex') + '"'}).end();
    } else if((req.method === 'GET' || req.method === 'HEAD') && !url.search) {
      const object = objects.get(key);
      if(!object) { res.writeHead(404).end(); return; }
      let body = object.bytes;
      const headers = {'Content-Type': object.type, 'Accept-Ranges': 'bytes'};
      const range = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range || '');
      if(range) {
        const start = +range[1], end = Math.min(+range[2], body.length - 1);
        if(start >= body.length) { res.writeHead(416).end(); return; }
        headers['Content-Range'] = `bytes ${start}-${end}/${body.length}`;
        body = body.subarray(start, end + 1);
      }
      res.writeHead(range ? 206 : 200, {...headers, 'Content-Length': body.length});
      res.end(req.method === 'HEAD' ? undefined : body);
    } else if(req.method === 'DELETE') {
      objects.delete(key);
      res.writeHead(204).end();
    } else {
      errors.push(req.method + ' ' + req.url);
      console.error('Unsupported storage request', req.method, req.url);
      res.writeHead(501).end();
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {server, errors, objects, url: 'http://127.0.0.1:' + server.address().port};
}
