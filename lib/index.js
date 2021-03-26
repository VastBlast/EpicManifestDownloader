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
			throw new Error('manifest or serverPath is missing');
		}
		if (opts.saveChunks && opts.chunksFolder == undefined) {
			throw new Error('chunksFolder is undefined');
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
				throw new Error('chunksFolder is invalid');
			}
		}
		opts.saveChunks ? this.saveChunks = true : false
		opts.debugLog ? this.debugLog = true : false
		opts.host ? this.host = opts.host : false

			if (opts.asyncOpts && typeof opts.asyncOpts == "number" && opts.asyncOpts > 0) {
				this.asyncOpts = opts.asyncOpts
			} else if (opts.asyncOpts) {
				throw new Error('invalid asyncOpts value');
			}

			var manifestData = opts.manifest;
		if (!Buffer.isBuffer(manifestData)) {
			var manifestData = await readFile(manifestData);
		}
		this.manifest = JSON.parse(manifestData);

		this.manifest = manifestFormat(this.manifest);
		this.started = true;
		return true;
	}

	getFileList = function (withHash = false) {
		if (!this.started) {
			throw new Error('downloader has not been started');
			return;
		}

		const files = [];
		for (const fileName in this.manifest['FileManifestList']) {
			const file = this.manifest['FileManifestList'][fileName];
			if (withHash) {
				files.push({
					FileName: fileName,
					Hash: file['FileHash']
				});
			} else {
				files.push(fileName);
			}
		}

		return files;
	}

	download = async function (fileName, savePath = false) {
		if (!this.started) {
			throw new Error('downloader has not been started');
			return;
		}
		if (!fileName) {
			throw new Error('missing fileName');
		}

		const file = this.manifest['FileManifestList'][fileName];
		if (!file) {
			throw new Error('file not found');
		}

		if (savePath) {
			var fd = await openFS(savePath, 'w');
			await ftruncateFS(fd, file['FileSize']);
		} else {
			var fd = Buffer.alloc(file['FileSize']);
		}

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
				if (fs.existsSync(chunkPath)) {
					try {
						var res = await readFile(chunkPath);
					} catch (e) {}
				}
			}

			if (!res) {
				var res = await http.request({
					method: 'GET',
					host: this.host,
					port: 80,
					path: urlPath
				});
			}

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

		if (!savePath) {
			return fd;
		} else {
			await closeFS(fd);
			return true;
		}
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
		var group = manifest['DataGroupList'][guid];
		var group = parseInt(group);
		if (group < 10) {
			var group = `0${group}`;
		}
		var group = group.toString();
		manifest['DataGroupList'][guid] = group;
	}

	return manifest;
}
