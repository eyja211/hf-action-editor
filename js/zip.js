/**
 * zip.js — 自写 ZIP 生成器（无外部依赖）+ 导出 HFWorkshop 可导入的 zip
 *
 * 压缩：优先 CompressionStream('deflate-raw')（Edge/Chrome 内建），不可用时 STORE 存储。
 * 布局：与用户手动压缩一致 —— zip 根目录直接平铺文件（Spt.json / Limb_*.json / *.png）。
 */
(function (g) {
    'use strict';

    // ---------- CRC32 ----------
    var CRC_TABLE = (function () {
        var t = new Uint32Array(256);
        for (var n = 0; n < 256; n++) {
            var c = n;
            for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            t[n] = c >>> 0;
        }
        return t;
    })();

    function crc32(bytes) {
        var c = 0xFFFFFFFF;
        for (var i = 0; i < bytes.length; i++) {
            c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
        }
        return (c ^ 0xFFFFFFFF) >>> 0;
    }

    async function deflateRaw(bytes) {
        if (typeof CompressionStream === 'undefined') return null;
        try {
            var cs = new CompressionStream('deflate-raw');
            var stream = new Blob([bytes]).stream().pipeThrough(cs);
            var buf = await new Response(stream).arrayBuffer();
            return new Uint8Array(buf);
        } catch (e) {
            return null;
        }
    }

    /**
     * 生成 zip。files: [{name: string, data: Uint8Array}]
     * 返回 Blob。
     */
    async function makeZip(files) {
        var chunks = [];
        var central = [];
        var offset = 0;
        var encoder = new TextEncoder();

        for (var i = 0; i < files.length; i++) {
            var f = files[i];
            var nameBytes = encoder.encode(f.name);
            var crc = crc32(f.data);
            var compressed = await deflateRaw(f.data);
            var method = 8, payload = compressed;
            if (!compressed || compressed.length >= f.data.length) {
                method = 0; payload = f.data;
            }
            var lh = new DataView(new ArrayBuffer(30));
            lh.setUint32(0, 0x04034b50, true);
            lh.setUint16(4, 20, true);          // version needed
            lh.setUint16(6, 0x0800, true);      // UTF-8 文件名
            lh.setUint16(8, method, true);
            lh.setUint16(10, 0, true);          // time
            lh.setUint16(12, 0x21, true);       // date (1980-1-1)
            lh.setUint32(14, crc, true);
            lh.setUint32(18, payload.length, true);
            lh.setUint32(22, f.data.length, true);
            lh.setUint16(26, nameBytes.length, true);
            lh.setUint16(28, 0, true);
            chunks.push(new Uint8Array(lh.buffer), nameBytes, payload);

            var ch = new DataView(new ArrayBuffer(46));
            ch.setUint32(0, 0x02014b50, true);
            ch.setUint16(4, 20, true);
            ch.setUint16(6, 20, true);
            ch.setUint16(8, 0x0800, true);
            ch.setUint16(10, method, true);
            ch.setUint16(12, 0, true);
            ch.setUint16(14, 0x21, true);
            ch.setUint32(16, crc, true);
            ch.setUint32(20, payload.length, true);
            ch.setUint32(24, f.data.length, true);
            ch.setUint16(28, nameBytes.length, true);
            ch.setUint32(42, offset, true);
            central.push(new Uint8Array(ch.buffer), nameBytes);

            offset += 30 + nameBytes.length + payload.length;
        }

        var centralSize = central.reduce(function (s, c) { return s + c.length; }, 0);
        var eocd = new DataView(new ArrayBuffer(22));
        eocd.setUint32(0, 0x06054b50, true);
        eocd.setUint16(8, files.length, true);
        eocd.setUint16(10, files.length, true);
        eocd.setUint32(12, centralSize, true);
        eocd.setUint32(16, offset, true);
        chunks.push.apply(chunks, central);
        chunks.push(new Uint8Array(eocd.buffer));
        return new Blob(chunks, { type: 'application/zip' });
    }

    function download(blob, name) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
    }

    // ---------- 导出流程 ----------

    async function exportZips(App) {
        var busy = App.setBusy('正在生成 zip…');
        try {
            var encoder = new TextEncoder();
            var char = App.char;

            // Spt zip
            var sptFiles = [{ name: 'Spt.json', data: encoder.encode(char.spt.serialize()) }];
            download(await makeZip(sptFiles), char.sptFolder + '.zip');

            // 每个 Lmi 集合一个 zip：全部 json + png（含未保存的替换/新增）
            var zipCount = 1;
            for (var si = 0; si < char.lmiSets.length; si++) {
                var set = char.lmiSets[si];
                var lmiFiles = [];
                set.limbFiles.forEach(function (jf) {
                    lmiFiles.push({ name: jf.name, data: encoder.encode(jf.serialize()) });
                });
                set.picFiles.forEach(function (jf) {
                    lmiFiles.push({ name: jf.name, data: encoder.encode(jf.serialize()) });
                });
                var pngNames = [];   // 集合内裸名
                set.pngs.forEach(function (_, name) { pngNames.push(name); });
                if (App.pendingPngs) {
                    App.pendingPngs.forEach(function (_, key) {
                        // 键格式：主集合 "N.png"，附加集合 "folder/N.png"
                        var slash = key.indexOf('/');
                        var owner = slash > 0 ? key.slice(0, slash) : char.lmiSets[0].folder;
                        var bare = slash > 0 ? key.slice(slash + 1) : key;
                        if (owner === set.folder && pngNames.indexOf(bare) === -1) pngNames.push(bare);
                    });
                }
                for (var i = 0; i < pngNames.length; i++) {
                    var name = pngNames[i];
                    var key = set.qualify(name);
                    var blob = (App.pendingPngs && App.pendingPngs.get(key)) || set.pngs.get(name);
                    if (!blob) continue;
                    var buf = await blob.arrayBuffer();
                    lmiFiles.push({ name: name, data: new Uint8Array(buf) });
                }
                download(await makeZip(lmiFiles), set.folder + '.zip');
                zipCount++;
            }

            App.toast('已导出 ' + zipCount + ' 个 zip（浏览器下载）。用 HFWorkshop 分别导入对应数据即可。');
        } catch (e) {
            console.error(e);
            alert('导出失败：' + e.message);
        } finally {
            busy();
        }
    }

    g.HFZip = { makeZip: makeZip, crc32: crc32 };
    g.HFZipUI = { exportZips: exportZips };
})(typeof window !== 'undefined' ? window : globalThis);
