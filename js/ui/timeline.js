/**
 * ui/timeline.js — 底部时间轴：帧缩略图 + 播放控制 + 帧操作
 */
(function (g) {
    'use strict';
    var HFJ = g.HFJ, Skel = g.HFSkel, Render = g.HFRender;

    var THUMB_W = 72, THUMB_H = 72;

    function init(App) {
        var stripEl = document.getElementById('frame-strip');
        var thumbs = new Map();   // frameIndex → canvas

        document.getElementById('btn-play').onclick = function () { App.togglePlay(); };
        document.getElementById('btn-frame-copy').onclick = function () { App.duplicateCurrentFrame(); };
        document.getElementById('btn-frame-del').onclick = function () { App.deleteCurrentFrame(); };
        var speedEl = document.getElementById('play-speed');
        speedEl.onchange = function () { App.playSpeed = parseFloat(speedEl.value) || 1; };

        function refresh() {
            stripEl.innerHTML = '';
            thumbs.clear();
            if (!App.char) return;
            var range = App.actionRange();
            if (!range) return;
            for (var fi = range.start; fi <= range.end; fi++) {
                stripEl.appendChild(makeChip(fi, range));
            }
            highlight(App.frameIndex);
        }

        function makeChip(fi, range) {
            var f = App.char.getFrame(fi);
            var chip = document.createElement('div');
            chip.className = 'frame-chip';
            chip.dataset.fi = fi;
            var cv = document.createElement('canvas');
            cv.width = THUMB_W; cv.height = THUMB_H;
            drawThumb(cv, fi);
            chip.appendChild(cv);
            var label = document.createElement('div');
            label.className = 'chip-label';
            var dur = f ? (HFJ.getV(f, 'duration') || 0) : 0;
            var last = f && HFJ.getV(f, 'last') === true;
            label.innerHTML = '<b>' + (fi - range.start) + '</b><span title="停留 tick 数">⏱' + dur + '</span>' +
                (last ? '<span class="last-flag" title="动作末帧">■</span>' : '');
            chip.appendChild(label);
            chip.onclick = function () { App.stopPlay(); App.refreshTransport(); App.selectFrame(fi); };
            thumbs.set(fi, cv);
            return chip;
        }

        function drawThumb(cv, fi) {
            var fp = App.pose(fi);
            var ctx = cv.getContext('2d');
            ctx.clearRect(0, 0, cv.width, cv.height);
            if (!fp || !App.images) return;
            // 视图：以根点为中心，覆盖 ±140 逻辑像素
            var s = Math.min(cv.width, cv.height) / 300;
            var view = {
                a: s, b: 0, c: 0, d: s,
                tx: cv.width / 2 - Skel.ROOT_X * s,
                ty: cv.height * 0.82 - (Skel.ROOT_Y + (HFJ.getV(fp.frame, 'footY') || 0)) * s
            };
            Render.drawFrame(ctx, fp, App.images, view, { smoothing: true });
        }

        function invalidateThumb(fi) {
            if (fi === undefined) { refresh(); return; }
            var cv = thumbs.get(fi);
            if (cv) drawThumb(cv, fi);
        }

        function highlight(fi) {
            stripEl.querySelectorAll('.frame-chip').forEach(function (el) {
                el.classList.toggle('sel', parseInt(el.dataset.fi, 10) === fi);
            });
            var sel = stripEl.querySelector('.frame-chip.sel');
            if (sel) sel.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }

        function refreshTransport() {
            document.getElementById('btn-play').textContent = App.playing ? '⏸ 暂停' : '▶ 播放';
        }

        return {
            refresh: refresh,
            invalidateThumb: invalidateThumb,
            highlight: highlight,
            refreshTransport: refreshTransport
        };
    }

    g.HFPanel_timeline = { init: init };
})(window);
