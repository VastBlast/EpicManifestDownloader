module.exports = {
    hex2bin: function (hexSource) {
        const bin = Buffer.from(hexSource, 'hex').toString();
        return bin;
    },

    bin2hex: function (binSource) {
        const hex = Buffer.from(binSource, 'utf8').toString("hex");
        return hex;
    },

    splitStr: function (str, splitLength = 1) {
        var sets = [];
        for (var i = 0, charsLength = str.length; i < charsLength; i += splitLength) {
            sets.push(str.substring(i, i + splitLength));
        }
        return sets;
    },

    dec2hex: function (dec) { //integer to hex
        var hex = parseInt(dec).toString(16);
        if (hex.length == 1) {
            hex = '0' + hex; //adds leading zero
        }
        return hex;
    },

    hex2dec: function (hex, bigStr = false) {
        //returns string, used for long ints or int if false
        return (bigStr) ? BigInt('0x' + hex).toString(10) : parseInt(hex, 16)
    }
}
