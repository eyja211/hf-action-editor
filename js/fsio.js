/**
 * fsio.js — 本地文件夹读写（File System Access API）
 *
 * 打开：用户选择包含角色导出的文件夹，自动识别其中的
 *   "* - Data.Global_*Spt"（含 Spt.json）与 "* - Data.Global_*Lmi"（含 Limb/LimbPic json + png）
 *   也兼容直接选中 Spt 文件夹或 Lmi 文件夹的父目录组合。
 * 保存：把脏 JSON 写回对应文件夹（PNG 由贴图工具单独写）。
 *
 * 需要 Edge/Chrome（showDirectoryPicker）。不可用时由 app 提示改用 zip 导出流程（M7 降级路径）。
 */
(function (g) {
    'use strict';

    function supported() {
        return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
    }

    /** 让用户挑选角色根文件夹并读取全部所需文件 */
    async function openCharacterFolder() {
        var root = await window.showDirectoryPicker({ mode: 'readwrite' });
        return await scanRoot(root);
    }

    /** 扫描根目录，定位 Spt/Lmi 文件夹（支持根目录本身就是其中之一的情况） */
    async function scanRoot(root) {
        var sptDirs = [], lmiDirs = [];
        for await (var entry of root.values()) {
            if (entry.kind !== 'directory') continue;
            if (/Spt$/i.test(entry.name)) sptDirs.push(entry);
            else if (/Lmi$/i.test(entry.name)) lmiDirs.push(entry);
        }
        // 根目录自身可能直接是 Spt 文件夹（含 Spt.json）
        if (sptDirs.length === 0) {
            try {
                await root.getFileHandle('Spt.json');
                sptDirs.push(root);
            } catch (e) { /* 无 Spt.json */ }
        }
        if (sptDirs.length === 0) {
            throw new Error('所选文件夹内未找到 "* - Data.Global_*Spt" 文件夹（需包含 Spt.json）');
        }
        if (lmiDirs.length === 0) {
            throw new Error('所选文件夹内未找到 "* - Data.Global_*Lmi" 文件夹（需包含 Limb_*.json / LimbPic_*.json / *.png）');
        }
        return { root: root, sptDirs: sptDirs, lmiDirs: lmiDirs };
    }

    /** 简单配对：优先选与 Spt 文件夹共享角色名片段的 Lmi；不唯一时取第一个 */
    function pairLmi(sptDir, lmiDirs) {
        var m = /Data\.Global_(.+?)Spt/i.exec(sptDir.name);
        if (m) {
            var id = m[1].toLowerCase();
            var hit = lmiDirs.find(function (d) { return d.name.toLowerCase().indexOf(id) !== -1; });
            if (hit) return hit;
        }
        return lmiDirs[0];
    }

    /** 读取一个 Spt + 多个 Lmi 文件夹的全部文件内容（第一个 Lmi = 与 Spt 配对的主集合） */
    async function readCharacter(sptDir, lmiDir, extraLmiDirs) {
        var sptFileHandle = await sptDir.getFileHandle('Spt.json');
        var sptText = await (await sptFileHandle.getFile()).text();

        async function readLmiDir(dir) {
            var jsons = new Map(), pngs = new Map();
            for await (var entry of dir.values()) {
                if (entry.kind !== 'file') continue;
                var name = entry.name;
                if (/\.json$/i.test(name)) {
                    jsons.set(name, await (await entry.getFile()).text());
                } else if (/\.png$/i.test(name)) {
                    pngs.set(name, await (await entry.getFile()));  // File(Blob)
                }
            }
            return { jsons: jsons, pngs: pngs };
        }

        var primary = await readLmiDir(lmiDir);
        var extraLmi = [];
        var lmiDirHandles = [lmiDir];
        for (var i = 0; i < (extraLmiDirs || []).length; i++) {
            var d = extraLmiDirs[i];
            var read = await readLmiDir(d);
            extraLmi.push({ folder: d.name, jsons: read.jsons, pngs: read.pngs });
            lmiDirHandles.push(d);
        }
        return {
            sptFolder: sptDir.name,
            lmiFolder: lmiDir.name,
            sptText: sptText,
            lmiJsons: primary.jsons,
            pngs: primary.pngs,
            extraLmi: extraLmi,
            handles: { sptDir: sptDir, lmiDir: lmiDir, lmiDirs: lmiDirHandles }
        };
    }

    /** 写文本文件 */
    async function writeText(dirHandle, fileName, text) {
        var fh = await dirHandle.getFileHandle(fileName, { create: true });
        var w = await fh.createWritable();
        await w.write(text);
        await w.close();
    }

    /** 写二进制（Blob/ArrayBuffer/Uint8Array） */
    async function writeBinary(dirHandle, fileName, data) {
        var fh = await dirHandle.getFileHandle(fileName, { create: true });
        var w = await fh.createWritable();
        await w.write(data);
        await w.close();
    }

    /**
     * 保存角色的脏 JSON（Spt→sptDir，各 Lmi 集合→对应 lmiDirs[si]）。
     * 成功后把各文件 origText 更新为新文本、清除脏标记。返回写入的文件名列表。
     */
    async function saveDirty(char, handles) {
        var written = [];
        var jobs = char.serializeDirty();
        for (var i = 0; i < jobs.length; i++) {
            var job = jobs[i];
            var dir = job.folder === 'spt'
                ? handles.sptDir
                : (handles.lmiDirs ? handles.lmiDirs[job.si] : handles.lmiDir);
            if (!dir) throw new Error('找不到 Lmi 文件夹句柄（集合 ' + job.si + '）：' + job.name);
            await writeText(dir, job.name, job.text);
            written.push(job.name);
        }
        // 更新基准
        char.allJsonFiles().forEach(function (it) {
            if (it.file.dirty) {
                it.file.origText = it.file.serialize();
                it.file.dirty = false;
            }
        });
        return written;
    }

    /**
     * 降级路径：不支持 showDirectoryPicker 时用 <input webkitdirectory> 只读载入。
     * 返回与 readCharacter 相同结构（handles=null，保存需走 zip 导出）。
     */
    function openViaInput() {
        return new Promise(function (resolve, reject) {
            var input = document.createElement('input');
            input.type = 'file';
            input.webkitdirectory = true;
            input.onchange = function () {
                try {
                    var files = Array.prototype.slice.call(input.files || []);
                    if (!files.length) { reject(new Error('未选择文件夹')); return; }
                    var sptFile = null, lmiByDir = new Map();   // dirName → [{file}]
                    files.forEach(function (f) {
                        var rel = f.webkitRelativePath || f.name;
                        var parts = rel.split('/');
                        var dir = parts.length >= 2 ? parts[parts.length - 2] : '';
                        if (/Spt$/i.test(dir) && f.name === 'Spt.json') {
                            sptFile = { file: f, dir: dir };
                        } else if (/Lmi$/i.test(dir) && (/\.json$/i.test(f.name) || /\.png$/i.test(f.name))) {
                            if (!lmiByDir.has(dir)) lmiByDir.set(dir, []);
                            lmiByDir.get(dir).push(f);
                        }
                    });
                    if (!sptFile) { reject(new Error('所选文件夹内未找到 *Spt/Spt.json')); return; }
                    if (lmiByDir.size === 0) { reject(new Error('所选文件夹内未找到 *Lmi 数据文件')); return; }
                    // 主 Lmi：按角色 id 片段配对，否则第一个
                    var dirs = Array.from(lmiByDir.keys());
                    var primaryDir = dirs[0];
                    var m = /Data\.Global_(.+?)Spt/i.exec(sptFile.dir);
                    if (m) {
                        var id = m[1].toLowerCase();
                        var hit = dirs.find(function (d) { return d.toLowerCase().indexOf(id) !== -1; });
                        if (hit) primaryDir = hit;
                    }
                    sptFile.file.text().then(function (sptText) {
                        var reads = [];
                        function readDir(dir) {
                            var jsons = new Map(), pngs = new Map();
                            lmiByDir.get(dir).forEach(function (f) {
                                if (/\.json$/i.test(f.name)) {
                                    reads.push(f.text().then(function (t) { jsons.set(f.name, t); }));
                                } else {
                                    pngs.set(f.name, f);
                                }
                            });
                            return { jsons: jsons, pngs: pngs };
                        }
                        var primary = readDir(primaryDir);
                        var extraLmi = dirs.filter(function (d) { return d !== primaryDir; })
                            .map(function (d) {
                                var r = readDir(d);
                                return { folder: d, jsons: r.jsons, pngs: r.pngs };
                            });
                        Promise.all(reads).then(function () {
                            resolve({
                                sptFolder: sptFile.dir,
                                lmiFolder: primaryDir,
                                sptText: sptText,
                                lmiJsons: primary.jsons,
                                pngs: primary.pngs,
                                extraLmi: extraLmi,
                                handles: null
                            });
                        });
                    }).catch(reject);
                } catch (e) { reject(e); }
            };
            input.click();
        });
    }

    g.HFFs = {
        supported: supported,
        openCharacterFolder: openCharacterFolder,
        openViaInput: openViaInput,
        pairLmi: pairLmi,
        readCharacter: readCharacter,
        writeText: writeText,
        writeBinary: writeBinary,
        saveDirty: saveDirty
    };
})(typeof window !== 'undefined' ? window : globalThis);
