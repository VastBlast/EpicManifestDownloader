const http = require('http');

module.exports = {
    request: function (params, postData) { //returns raw buffer
        return new Promise(function (resolve, reject) {
            const req = http.request(params, function (res) {
                // reject on bad status
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    return reject(new Error('statusCode=' + res.statusCode));
                }
                // cumulate data
                const body = [];
                res.on('data', function (chunk) {
                    body.push(chunk);
                });
                // resolve on end
                res.on('end', function () {
                    resolve(Buffer.concat(body));
                });
            });
            // reject on request error
            req.on('error', function (err) {
                // This is not a "Second reject", just a different sort of failure
                reject(err);
            });
            if (postData) {
                req.write(postData);
            }
            // IMPORTANT
            req.end();
        });
    }
}
