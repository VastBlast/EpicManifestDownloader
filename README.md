# EpicManifestDownloader
 NodeJS library to download files from manifests used by the Epic Games Launcher

## Installation
```
npm i epic-manifest-downloader
```

## Example
```js
const { Downloader } = require('epic-manifest-downloader');

(async() => {
	const emd = new Downloader();
	await emd.downloadmanifest();
	await emd.start({
		manifest: './manifest.json',
		serverPath: '/Builds/Fortnite/CloudDir/ChunksV3',
		asyncOpts: 4
	});
	await emd.download("FortniteGame/Binaries/Win64/EasyAntiCheat/Launcher/SplashScreen.png", './splashscreen.png');
	//const splashBuffer = await emd.download("FortniteGame/Binaries/Win64/EasyAntiCheat/Launcher/SplashScreen.png");
})();
```
