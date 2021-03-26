const fs = require('fs');
const path = require('path');
const async = require('async');
const { promisify } = require('util');
const chunkMod = require('./chunk.js');
const http = require('./http.js');

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const openFS = promisify(fs.open);
const closeFS = promisify(fs.close);
const writeFS = promisify(fs.write);
const ftruncateFS = promisify(fs.ftruncate);

exports.Downloader = class Downloader {
    constructor() {
        this.host = 'download.epicgames.com';
        this.serverPath = undefined; //required, server download path where chunks are downloaded from (ex. /Builds/UnrealEngineLauncher/CloudDir/ChunksV3)
        this.manifest = undefined; //manifest buffer or file path, required
        this.chunksFolder = undefined; //use existing chunks in a certain folder, if they exist.. if not then download the chunks
        this.saveChunks = false;
        this.asyncOpts = 4; // maximum number of async operations at a time (while downloading chunks)
        this.debugLog = false; //console logging stuff

        this.started = false;
        this.fileList = undefined;
    }

    start = async function (opts) {
        if (!opts.manifest || !opts.serverPath) {
            throw 'manifest or serverPath is missing';
        }
        if (opts.saveChunks && opts.chunksFolder == undefined) {
            throw 'chunksFolder is undefined';
        }
        if (!opts['serverPath'].startsWith('/')) {
            opts['serverPath'] = "/" + opts['serverPath'];
        }
        if (!opts['serverPath'].endsWith('/')) {
            opts['serverPath'] = opts['serverPath'] + "/";
        }
        this.serverPath = opts['serverPath'];

        if (opts.chunksFolder) {
            if (fs.existsSync(opts.chunksFolder) && fs.lstatSync(opts.chunksFolder).isDirectory()) {
                this.chunksFolder = opts.chunksFolder;
            } else {
                throw 'chunksFolder is invalid';
            }
        }
        opts.saveChunks ? this.saveChunks = opts.saveChunks : null
            opts.debugLog ? this.debugLog = opts.debugLog : null
            opts.host ? this.host = opts.host : null

            //ugly code fix later
            if (opts.asyncOpts && typeof opts.asyncOpts == "number" && opts.asyncOpts > 0) {
                this.asyncOpts = opts.asyncOpts
            } else if (opts.asyncOpts) {
                throw 'invalid asyncOpts value';
            }

            var manifestData = opts.manifest;
        if (!Buffer.isBuffer(manifestData)) {
            var manifestData = await readFile(manifestData);
        }
        this.manifest = JSON.parse(manifestData);

        this.manifest = manifestFormat(this.manifest);
        return this.started = true;
    }

    getFileList = function (withHash = false) {
        if (!this.started) {
            throw 'downloader has not been started';
        }

        const files = [];
        for (const fileName in this.manifest['FileManifestList']) {
            const file = this.manifest['FileManifestList'][fileName];
            files.push((withHash) ? {
                FileName: fileName,
                Hash: file['FileHash']
            }
                 : fileName);

        }

        return files;
    }

    download = async function (fileName, savePath = false) {
        if (!this.started) {
            throw 'downloader has not been started';
        }
        if (!fileName) {
            throw 'missing fileName';
        }

        const file = this.manifest['FileManifestList'][fileName];
        if (!file) {
            throw 'file not found';
        }

        const fd = (savePath) ? await openFS(savePath, 'w') : Buffer.alloc(file['FileSize']);
        (savePath) ? await ftruncateFS(fd, file['FileSize']) : null;

        await async.forEachLimit(file['FileChunkParts'], this.asyncOpts, async(chunk) => {
            const guid = chunk['Guid'];
            const group = this.manifest['DataGroupList'][guid];
            const hash = this.manifest['ChunkHashList'][guid];
            const urlPath = `${this.serverPath}${group}/${hash}_${guid}.chunk`;
            this.debugLog ? console.log(urlPath) : false;
            const rangeStart = chunk['Offset'];
            const rangeEnd = chunk['Offset'] + chunk['Size'];

            if (this.chunksFolder) {
                var chunkPath = path.join(this.chunksFolder, `${guid}.chunk`);
                try {
                    var res = (fs.existsSync(chunkPath)) ? await readFile(chunkPath) : null;
                } catch (e) {}
            }

            //if (!res)
            var res = (!res) ? await http.request({
                method: 'GET',
                host: this.host,
                port: 80,
                path: urlPath
            }) : res;

            if (this.chunksFolder && this.saveChunks) {
                if (!fs.existsSync(chunkPath)) {
                    try {
                        await writeFile(chunkPath, res);
                    } catch (e) {}
                }
            }

            var chunkData = await chunkMod.decompress(res);
            var chunkData = chunkData.slice(rangeStart, rangeEnd);

            if (savePath) {
                await writeFS(fd, chunkData, 0, chunk['Size'], chunk['fileStart']);
            } else {
                chunkData.copy(fd, chunk['fileStart']);
            }

        });

        return (!savePath ? fd : await closeFS(fd));
    }
}

function manifestFormat(manifest) {
    manifest['FileManifestList'] = Object.assign({}, manifest['FileManifestList']); //convert array to object

    //reformat FileManifestList
    for (const fileIndex in manifest['FileManifestList']) {
        const file = manifest['FileManifestList'][fileIndex];
        const fileName = file['Filename'];
        delete manifest['FileManifestList'][fileIndex];

        manifest['FileManifestList'][fileName] = {
            FileHash: file['FileHash'],
            FileSize: 0,
            FileChunkParts: file['FileChunkParts'],
        }

        //reformat chunks in each file
        for (const chunkIndex in file['FileChunkParts']) {
            const chunk = file['FileChunkParts'][chunkIndex];
            const offset = parseInt(chunkMod.blob2hex(chunk['Offset'], true, true));
            const size = parseInt(chunkMod.blob2hex(chunk['Size'], true, true));

            if (chunkIndex == 0) {
                file['FileChunkParts'][chunkIndex]['fileStart'] = 0;
                //file['FileChunkParts'][chunkIndex]['fileEnd'] = size;
            } else {
                const prevChunk = file['FileChunkParts'][chunkIndex - 1];
                file['FileChunkParts'][chunkIndex]['fileStart'] = prevChunk['fileStart'] + prevChunk['Size'];
                //file['FileChunkParts'][chunkIndex]['fileEnd'] = prevChunk['fileEnd'] + (offset + size);
            }

            file['FileChunkParts'][chunkIndex]['Offset'] = offset;
            file['FileChunkParts'][chunkIndex]['Size'] = size;
            manifest['FileManifestList'][fileName]['FileSize'] += size;
        }
    }

    //reformat ChunkHashList
    for (const guid in manifest['ChunkHashList']) {
        if (manifest['ChunkHashList'][guid] == '000000000000000000000000') {
            continue;
        }
        manifest['ChunkHashList'][guid] = chunkMod.blob2hex(manifest['ChunkHashList'][guid]);
    }

    //reformat DataGroupList
    for (const guid in manifest['DataGroupList']) {
        var group = parseInt(manifest['DataGroupList'][guid]);
        group < 10 ? group = `0${group}` : null;
        var group = group.toString();
        manifest['DataGroupList'][guid] = group;
    }

    return manifest;
}
