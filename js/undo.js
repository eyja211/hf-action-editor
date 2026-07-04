/**
 * undo.js — 命令模式撤销/重做栈
 * 命令 = { label, undo(), redo() }；拖拽手势用 beginBatch/endBatch 合并为单命令。
 */
(function (g) {
    'use strict';

    function UndoStack(limit) {
        this.limit = limit || 200;
        this.stack = [];
        this.index = 0;         // 指向"下一个 redo 位置"
        this.batch = null;
        this.onChange = null;
    }

    UndoStack.prototype.push = function (cmd) {
        if (this.batch) { this.batch.cmds.push(cmd); return; }
        this.stack.length = this.index;
        this.stack.push(cmd);
        if (this.stack.length > this.limit) this.stack.shift();
        this.index = this.stack.length;
        this._notify();
    };

    /** 执行并入栈 */
    UndoStack.prototype.exec = function (cmd) {
        cmd.redo();
        this.push(cmd);
    };

    UndoStack.prototype.beginBatch = function (label) {
        if (this.batch) this.endBatch();
        this.batch = { label: label, cmds: [] };
    };

    UndoStack.prototype.endBatch = function () {
        var b = this.batch;
        this.batch = null;
        if (!b || b.cmds.length === 0) return;
        var cmds = b.cmds;
        this.push({
            label: b.label,
            undo: function () { for (var i = cmds.length - 1; i >= 0; i--) cmds[i].undo(); },
            redo: function () { for (var i = 0; i < cmds.length; i++) cmds[i].redo(); }
        });
    };

    UndoStack.prototype.canUndo = function () { return this.index > 0; };
    UndoStack.prototype.canRedo = function () { return this.index < this.stack.length; };

    UndoStack.prototype.undo = function () {
        if (!this.canUndo()) return null;
        var cmd = this.stack[--this.index];
        cmd.undo();
        this._notify();
        return cmd;
    };

    UndoStack.prototype.redo = function () {
        if (!this.canRedo()) return null;
        var cmd = this.stack[this.index++];
        cmd.redo();
        this._notify();
        return cmd;
    };

    UndoStack.prototype.clear = function () {
        this.stack = [];
        this.index = 0;
        this.batch = null;
        this._notify();
    };

    UndoStack.prototype._notify = function () { if (this.onChange) this.onChange(this); };

    g.HFUndo = { UndoStack: UndoStack };
})(typeof window !== 'undefined' ? window : globalThis);
