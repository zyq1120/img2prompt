import http from 'http';
import net from 'net';
const u = new URL(process.env.https_proxy || process.env.http_proxy);
const UP_HOST = u.hostname, UP_PORT = Number(u.port) || 3128;
const AUTH = 'Basic ' + Buffer.from(`${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`).toString('base64');
console.log('upstream:', UP_HOST + ':' + UP_PORT);
const server = http.createServer((clientReq, clientRes) => {
  console.log('HTTP', clientReq.method, clientReq.url);
  try {
    const headers = { ...clientReq.headers };
    delete headers['host']; // let Node set Host from the upstream authority (Node 24 validates this)
    headers['proxy-authorization'] = AUTH;
    const upReq = http.request({ host: UP_HOST, port: UP_PORT, method: clientReq.method, path: clientReq.url, headers }, (upRes) => {
      clientRes.writeHead(upRes.statusCode, upRes.headers); upRes.pipe(clientRes);
    });
    upReq.on('error', (e) => { console.log('http fwd err', e.message); try { clientRes.writeHead(502); clientRes.end('err'); } catch {} });
    clientReq.pipe(upReq);
  } catch (e) {
    console.log('handler err', e.message);
    try { clientRes.writeHead(502); clientRes.end('err'); } catch {}
  }
});
server.on('connect', (req, clientSocket, head) => {
  console.log('CONNECT', req.url);
  const upSock = net.connect(UP_PORT, UP_HOST, () => {
    console.log('upstream connected, sending CONNECT');
    upSock.write(`CONNECT ${req.url} HTTP/1.1\r\nHost: ${req.url}\r\nProxy-Authorization: ${AUTH}\r\n\r\n`);
  });
  let established = false, buf = Buffer.alloc(0);
  upSock.on('data', (chunk) => {
    if (established) return;
    buf = Buffer.concat([buf, chunk]);
    const idx = buf.indexOf('\r\n\r\n');
    if (idx === -1) return;
    const sl = buf.slice(0, buf.indexOf('\r\n')).toString();
    console.log('upstream reply:', sl);
    if (/^HTTP\/1\.[01] 200/.test(sl)) {
      established = true;
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      clientSocket.write(buf.slice(idx + 4));
      if (head && head.length) clientSocket.write(head);
      upSock.pipe(clientSocket); clientSocket.pipe(upSock);
    } else { clientSocket.end(buf); upSock.end(); }
  });
  upSock.on('error', (e) => { console.log('upstream err', e.message); clientSocket.destroy(); });
  clientSocket.on('error', () => upSock.destroy());
});
server.on('clientError', (e) => { console.log('clientError', e.message); });
server.listen(18080, '127.0.0.1', () => console.log('listening'));
