const fs = require('node:fs');
const path = require('node:path');

function loadScript(filename, stack = []) {
    const absolute = path.resolve(filename);
    if (stack.includes(absolute)) throw new Error('Circular include: ' + absolute);
    const raw = fs.readFileSync(absolute);
    if (!raw.subarray(0, 3).equals(Buffer.from([0xEF, 0xBB, 0xBF]))) {
        throw new Error('Illustrator source must retain its UTF-8 BOM: ' + absolute);
    }
    return raw.toString('utf8').replace(/^\uFEFF/, '')
        .replace(/^[ \t]*#include\s+"([^"\r\n]+)"[ \t]*$/gm, (_, include) =>
            loadScript(path.resolve(path.dirname(absolute), include), [...stack, absolute]))
        .replace(/^#target.*$/gm, '');
}
module.exports = {loadScript};
