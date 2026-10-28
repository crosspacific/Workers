// Rewrite only the protobuf response used by the search-box default words request.
var DEFAULT_TEXT = [230, 144, 156, 231, 180, 162, 232, 167, 134, 233, 162, 145, 227, 128, 129, 231, 149, 170, 229, 137, 167, 230, 136, 150, 117, 112, 228, 184, 187];
var HIDDEN_FIELDS = { 4: true, 7: true, 8: true, 9: true };

function asBytes(value) {
    if (value instanceof Uint8Array) return value;
    if (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer) return new Uint8Array(value);
    if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView && ArrayBuffer.isView(value)) {
        return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    }
    return null;
}

function readVarint(bytes, offset) {
    var value = 0;
    var shift = 0;
    while (offset < bytes.length && shift < 35) {
        var current = bytes[offset++];
        value += (current & 127) * Math.pow(2, shift);
        if ((current & 128) === 0) return { value: value, next: offset };
        shift += 7;
    }
    return null;
}

function writeVarint(value) {
    var result = [];
    do {
        var current = value % 128;
        value = Math.floor(value / 128);
        if (value > 0) current |= 128;
        result.push(current);
    } while (value > 0);
    return result;
}

function skipField(bytes, offset, wireType) {
    if (wireType === 0) {
        var varint = readVarint(bytes, offset);
        return varint ? varint.next : null;
    }
    if (wireType === 1) return offset + 8 <= bytes.length ? offset + 8 : null;
    if (wireType === 2) {
        var length = readVarint(bytes, offset);
        if (!length) return null;
        var end = length.next + length.value;
        return end <= bytes.length ? end : null;
    }
    if (wireType === 5) return offset + 4 <= bytes.length ? offset + 4 : null;
    return null;
}

function rewriteMessage(bytes) {
    var output = [];
    var offset = 0;
    var recognized = false;
    var hasDefaultText = false;

    while (offset < bytes.length) {
        var tag = readVarint(bytes, offset);
        if (!tag) return null;

        var field = Math.floor(tag.value / 8);
        var wireType = tag.value % 8;
        var fieldStart = offset;
        var fieldEnd = skipField(bytes, tag.next, wireType);
        if (fieldEnd === null) return null;

        if (wireType === 2 && field === 3) {
            output.push.apply(output, writeVarint(26));
            output.push.apply(output, writeVarint(DEFAULT_TEXT.length));
            output.push.apply(output, DEFAULT_TEXT);
            recognized = true;
            hasDefaultText = true;
        } else if (wireType === 2 && HIDDEN_FIELDS[field]) {
            recognized = true;
        } else if (wireType === 0 && field === 5) {
            recognized = true;
        } else {
            for (var i = fieldStart; i < fieldEnd; i++) output.push(bytes[i]);
        }
        offset = fieldEnd;
    }

    if (!recognized) return null;
    if (!hasDefaultText) {
        var prefix = writeVarint(26).concat(writeVarint(DEFAULT_TEXT.length), DEFAULT_TEXT);
        output = prefix.concat(output);
    }
    return new Uint8Array(output);
}

function writeUint32BE(value) {
    return [value >>> 24 & 255, value >>> 16 & 255, value >>> 8 & 255, value & 255];
}

function rewriteGrpcBody(bytes) {
    var output = [];
    var offset = 0;
    var changed = false;

    while (offset < bytes.length) {
        if (offset + 5 > bytes.length) return null;
        var compressed = bytes[offset];
        var length = ((bytes[offset + 1] * 16777216) + (bytes[offset + 2] * 65536) + (bytes[offset + 3] * 256) + bytes[offset + 4]);
        var bodyStart = offset + 5;
        var bodyEnd = bodyStart + length;
        if (compressed !== 0 || bodyEnd > bytes.length) return null;

        var rewritten = rewriteMessage(bytes.slice(bodyStart, bodyEnd));
        if (!rewritten) return null;
        output.push(compressed);
        output.push.apply(output, writeUint32BE(rewritten.length));
        for (var i = 0; i < rewritten.length; i++) output.push(rewritten[i]);
        changed = true;
        offset = bodyEnd;
    }

    return changed ? new Uint8Array(output) : null;
}

try {
    var response = $response;
    var body = response && asBytes(response.bodyBytes);
    var rewritten = body && rewriteGrpcBody(body);
    rewritten ? $done({ bodyBytes: rewritten }) : $done({});
} catch (error) {
    $done({});
}
