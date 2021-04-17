const zlib = require('zlib');
const { promisify } = require('util');
const zlibInflate = promisify(zlib.inflate);
const { splitStr, dec2hex, hex2dec } = require("./functions");

module.exports = {
    decompress: async function (data) {
        //const offset = data.readUIntLE(8, 1); //offset, byteLength
        const offset = data[8];
        var data = data.slice(offset == 120 ? 8 : offset);
        try {
            return await zlibInflate(data);
        } catch (e) {
            return data;
        }
    },

    //blobs are stored in sets of 3 digits, backwards.. this function parses them by splitting them and converting them to a hex string
    blob2hex: function (blob, reverse = true, returnInt = false) {
        const sets = splitStr(blob, 3); //divide all chars into sets of three (array)
        reverse ? sets.reverse() : false;
        let out = '';
        for (var val of sets) {
            out += dec2hex(val);
        }
        return (returnInt) ? (hex2dec(out, true)) : (out.toUpperCase());
    }
}
