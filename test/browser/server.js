/** test/browser/server.js — 静态文件服务器（伺服测试工作区） */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.md': 'text/plain; charset=utf-8'
};

function start(baseDir) {
    return new Promise(resolve => {
        const server = http.createServer((req, res) => {
            let p;
            try {
                p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
            } catch (e) {
                res.writeHead(400); res.end(); return;
            }
            const full = path.join(baseDir, p);
            if (!full.startsWith(baseDir) || !fs.existsSync(full) || !fs.statSync(full).isFile()) {
                res.writeHead(404); res.end('not found: ' + p); return;
            }
            res.writeHead(200, {
                'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream',
                'Cache-Control': 'no-store'
            });
            fs.createReadStream(full).pipe(res);
        });
        server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
    });
}

module.exports = { start };
