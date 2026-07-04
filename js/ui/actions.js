/**
 * ui/actions.js — 左侧动作列表面板
 */
(function (g) {
    'use strict';
    var HFJ = g.HFJ;

    function init(App) {
        var listEl = document.getElementById('action-list');
        var searchEl = document.getElementById('action-search');

        document.getElementById('btn-action-copy').onclick = function () {
            App.duplicateCurrentAction();
        };

        searchEl.oninput = function () { refresh(); };

        function refresh() {
            listEl.innerHTML = '';
            if (!App.char) return;
            var kw = (searchEl.value || '').toLowerCase();
            App.char.listActions().forEach(function (a) {
                var name = a.name || '(未命名)';
                if (kw && name.toLowerCase().indexOf(kw) === -1 && String(a.index).indexOf(kw) === -1) return;
                var li = document.createElement('li');
                li.className = a.index === App.actionIndex ? 'sel' : '';
                var hasFrames = typeof a.frameIndex === 'number' && a.frameIndex >= 0;
                li.innerHTML = '<span class="idx">' + a.index + '</span>' +
                    '<span class="name">' + esc(name) + '</span>' +
                    (hasFrames ? '<span class="fi">#' + a.frameIndex + '</span>' : '<span class="fi none">无帧</span>');
                li.onclick = function () { App.selectAction(a.index); };
                listEl.appendChild(li);
            });
            var sel = listEl.querySelector('.sel');
            if (sel) sel.scrollIntoView({ block: 'nearest' });
        }

        function esc(s) {
            return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
        }

        return { refresh: refresh };
    }

    g.HFPanel_actions = { init: init };
})(window);
