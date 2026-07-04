/**
 * all.js — 一次运行全部验证：round-trip 字节一致 + 矩阵回归
 * 运行：node test/all.js
 */
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');

let fail = 0;
for (const script of ['roundtrip.js', 'matrix.js']) {
    console.log('\n########## ' + script + ' ##########');
    const r = spawnSync(process.execPath, [path.join(__dirname, script)], {
        stdio: 'inherit'
    });
    if (r.status !== 0) fail++;
}
console.log(fail === 0 ? '\n✅ 全部测试通过' : '\n❌ ' + fail + ' 个测试脚本失败');
process.exit(fail);
