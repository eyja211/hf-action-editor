/**
 * images.js — PNG 位图仓库：pngName("N.png") → ImageBitmap 异步加载与缓存
 * 另提供特效着色缓存（游戏 ColorTransform 的近似）。
 */
(function (g) {
    'use strict';

    function ImageStore(pngBlobs) {
        this.blobs = pngBlobs;            // Map<"N.png", Blob>
        this.bitmaps = new Map();         // Map<"N.png", ImageBitmap>
        this.pending = new Map();
        this.tinted = new Map();          // Map<"N.png|effect", Canvas>
        this.onLoad = null;               // 位图就绪回调（触发重绘）
    }

    ImageStore.prototype.get = function (name) {
        var bm = this.bitmaps.get(name);
        if (bm) return bm;
        if (!this.pending.has(name) && this.blobs.has(name)) {
            var self = this;
            var p = createImageBitmap(this.blobs.get(name)).then(function (ib) {
                self.bitmaps.set(name, ib);
                self.pending.delete(name);
                if (self.onLoad) self.onLoad(name);
                return ib;
            }).catch(function (err) {
                console.error('位图解码失败:', name, err);
                self.pending.delete(name);
            });
            this.pending.set(name, p);
        }
        return null;
    };

    /** 预加载全部（打开角色后调用，避免首帧白屏） */
    ImageStore.prototype.preloadAll = function () {
        var self = this;
        var names = [];
        this.blobs.forEach(function (_, name) { names.push(name); });
        return Promise.all(names.map(function (n) {
            self.get(n);
            return self.pending.get(n) || Promise.resolve();
        }));
    };

    /** 更新/新增一张 PNG（贴图工具用） */
    ImageStore.prototype.put = function (name, blob) {
        this.blobs.set(name, blob);
        this.bitmaps.delete(name);
        var toDrop = [];
        this.tinted.forEach(function (_, key) {
            if (key.indexOf(name + '|') === 0) toDrop.push(key);
        });
        var self = this;
        toDrop.forEach(function (k) { self.tinted.delete(k); });
    };

    // 特效 ColorTransform 表（Spt.as 2669-2691）：[rMul,gMul,bMul, rOff,gOff,bOff]（偏移量近似忽略，原值 <1）
    var EFFECT_CT = {
        1: [0.75, 0.8, 1],
        2: [0.5, 0.6, 1],
        3: [0.2, 0.4, 1],
        10: [1, 0.4, 0.07], 11: [1, 0.4, 0.07],
        20: [0.7, 0.1, 0.7], 21: [0.7, 0.1, 0.7]
    };

    /** 取某 PNG 的特效着色版本（懒生成，canvas 乘法合成近似 ColorTransform 乘子） */
    ImageStore.prototype.getTinted = function (name, effect) {
        var ct = EFFECT_CT[effect];
        if (!ct) return this.get(name);
        var key = name + '|' + effect;
        var cached = this.tinted.get(key);
        if (cached) return cached;
        var src = this.get(name);
        if (!src) return null;
        var cv = document.createElement('canvas');
        cv.width = src.width; cv.height = src.height;
        var ctx = cv.getContext('2d');
        ctx.drawImage(src, 0, 0);
        ctx.globalCompositeOperation = 'multiply';
        ctx.fillStyle = 'rgb(' + Math.round(ct[0] * 255) + ',' + Math.round(ct[1] * 255) + ',' + Math.round(ct[2] * 255) + ')';
        ctx.fillRect(0, 0, cv.width, cv.height);
        ctx.globalCompositeOperation = 'destination-in';
        ctx.drawImage(src, 0, 0);   // 恢复 alpha
        this.tinted.set(key, cv);
        return cv;
    };

    g.HFImages = { ImageStore: ImageStore, EFFECT_CT: EFFECT_CT };
})(typeof window !== 'undefined' ? window : globalThis);
