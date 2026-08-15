#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, cp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const overlayRoot = path.resolve(scriptDir, '..');
const repositoryRoot = path.resolve(overlayRoot, '..', '..');
const upstream = JSON.parse(await readFile(path.join(overlayRoot, 'UPSTREAM.json'), 'utf8'));
const args = parseArgs(process.argv.slice(2));
const destination = path.resolve(args.destination || path.join(overlayRoot, '.work', 'vscode'));
const cacheDir = path.resolve(args.cache || path.join(overlayRoot, '.cache'));
const archive = path.resolve(args.archive || path.join(cacheDir, `vscode-${upstream.commit}.tar.gz`));

assertSafeDestination(destination);
await mkdir(cacheDir, { recursive: true });
if (!await exists(archive)) {
  if (args.offline) throw new Error(`Pinned upstream archive is not cached: ${archive}`);
  await download(upstream.archiveUrl, archive);
}
const digest = await hashFile(archive);
if (digest !== upstream.archiveSha256) throw new Error(`Upstream hash mismatch: expected ${upstream.archiveSha256}, got ${digest}`);
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
await run('tar', ['xzf', archive, '--strip-components=1', '-C', destination]);
if ((await readFile(path.join(destination, '.nvmrc'), 'utf8')).trim() !== upstream.node) throw new Error('Unexpected upstream Node version');

await applyCompatibilityPatches(destination);
await hardenBundledExtensions(destination);

const productPath = path.join(destination, 'product.json');
const product = {
  ...JSON.parse(await readFile(productPath, 'utf8')),
  ...JSON.parse(await readFile(path.join(overlayRoot, 'product.template.json'), 'utf8')),
  bibzcodeVersion: '7.8.0-r6',
  upstreamCommit: upstream.commit,
};
for (const key of ['defaultChatAgent','trustedExtensionAuthAccess','builtInExtensionsEnabledWithAutoUpdates','voiceWsUrl','webviewContentExternalBaseUrlTemplate','agentsTelemetryAppName','telemetryEndpoint','aiConfig','configurationSync','updateUrl','downloadUrl']) delete product[key];
product.builtInExtensions = (product.builtInExtensions || []).filter((entry) => !String(entry.name || '').toLowerCase().includes('copilot'));
await writeFile(productPath, `${JSON.stringify(product, null, '\t')}\n`);

await rm(path.join(destination, 'extensions', 'copilot'), { recursive: true, force: true });
await removeUnusedAgentSdkPackages(destination);
await removeVendorAgentBuildHooks(destination);
await applySecurityLockOverrides(destination);
const extensionTarget = path.join(destination, 'extensions', 'bibzcode-ai');
await rm(extensionTarget, { recursive: true, force: true });
await cp(path.join(overlayRoot, 'extension'), extensionTarget, { recursive: true });
await copyRuntime(extensionTarget);
await copyBrandAssets(destination);
await writeFile(path.join(destination, 'BIBZCODE_UPSTREAM.json'), `${JSON.stringify({ ...upstream, preparedAt: new Date().toISOString() }, null, 2)}\n`);
await run(process.execPath, [path.join(scriptDir, 'verify-prepared.mjs'), destination]);
console.log(`Prepared BibzCode IDE source at ${destination}`);
console.log(`Pinned upstream: ${upstream.tag} ${upstream.commit}`);
console.log(`Archive SHA-256: ${digest}`);

function parseArgs(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === '--offline') result.offline = true;
    else if (['--destination','--cache','--archive'].includes(value)) result[value.slice(2)] = values[++index];
    else throw new Error(`Unknown argument: ${value}`);
  }
  return result;
}
function assertSafeDestination(value) {
  const parsed = path.parse(value);
  if (value === parsed.root || value === path.resolve(process.env.HOME || '/nonexistent') || value === repositoryRoot || value === overlayRoot || value.length < parsed.root.length + 8) throw new Error(`Unsafe destination: ${value}`);
}
async function exists(value) { try { await access(value); return true; } catch { return false; } }
async function hashFile(file) { const hash=createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest('hex'); }
async function download(url,target) {
  const temporary=`${target}.partial`; await rm(temporary,{force:true});
  const response=await fetch(url,{redirect:'follow',headers:{'User-Agent':'BibzCode-IDE-builder'}});
  if(!response.ok||!response.body) throw new Error(`Download failed: ${response.status}`);
  await pipeline(Readable.fromWeb(response.body),createWriteStream(temporary,{mode:0o600})); await rm(target,{force:true}); await rename(temporary,target);
}
function run(command, commandArgs, options={}) { return new Promise((resolve,reject)=>{const child=spawn(command,commandArgs,{cwd:options.cwd,stdio:'inherit',shell:false});child.once('error',reject);child.once('exit',(code)=>code===0?resolve():reject(new Error(`${command} exited ${code}`)));}); }

async function applyCompatibilityPatches(sourceRoot) {
  const patchRoot=path.join(overlayRoot,'patches','vscodium');
  const platformDirectory=process.platform==='darwin'?'darwin':process.platform==='win32'?'win32':'linux';
  await run('git',['init','--quiet'],{cwd:sourceRoot});
  const common=path.join(patchRoot,'common');
  for(const name of (await readdir(common)).filter((entry)=>entry.endsWith('.json')).sort()) {
    const actions=JSON.parse(await readFile(path.join(common,name),'utf8'));
    for(const action of actions) {
      if(action.action!=='remove'||!Array.isArray(action.paths)) throw new Error(`Unsupported patch action: ${action.action}`);
      for(const relative of action.paths) { const target=path.resolve(sourceRoot,relative); if(!target.startsWith(`${sourceRoot}${path.sep}`)||!await exists(target)) throw new Error(`Invalid patch path: ${relative}`); await rm(target,{recursive:true,force:true}); }
    }
  }
  const patchFiles=[...(await readdir(common)).filter((entry)=>entry.endsWith('.patch')).sort().map((entry)=>path.join(common,entry)),...(await readdir(path.join(patchRoot,platformDirectory))).filter((entry)=>entry.endsWith('.patch')).sort().map((entry)=>path.join(patchRoot,platformDirectory,entry))];
  const replacements=new Map([['!!APP_NAME!!','BibzCode IDE'],['!!APP_NAME_LC!!','bibzcode'],['!!ASSETS_REPOSITORY!!','XbibzOfficial777/BibzCode'],['!!BINARY_NAME!!','bibzcode'],['!!GH_REPO_PATH!!','XbibzOfficial777/BibzCode'],['!!GLOBAL_DIRNAME!!','bibzcode'],['!!ORG_NAME!!','BibzCode'],['!!RELEASE_VERSION!!','7.8.0'],['!!TUNNEL_APP_NAME!!','bibzcode-tunnel']]);
  const temporaryPatch=path.join(sourceRoot,'.bibzcode-compatibility.patch');
  for(const patchFile of patchFiles) { let contents=await readFile(patchFile,'utf8'); for(const [search,value] of replacements) contents=contents.split(search).join(value); await writeFile(temporaryPatch,contents); await run('git',['apply','--check','--ignore-whitespace','--whitespace=nowarn',temporaryPatch],{cwd:sourceRoot}); await run('git',['apply','--ignore-whitespace','--whitespace=nowarn',temporaryPatch],{cwd:sourceRoot}); }
  await rm(temporaryPatch,{force:true}); await rm(path.join(sourceRoot,'.git'),{recursive:true,force:true});
}

async function hardenBundledExtensions(sourceRoot) {
  const markdownPath=path.join(sourceRoot,'extensions','markdown-language-features','package.json'); const markdown=JSON.parse(await readFile(markdownPath,'utf8'));
  const configs=Array.isArray(markdown.contributes?.configuration)?markdown.contributes.configuration:[markdown.contributes?.configuration]; const properties=configs.find((entry)=>entry?.properties?.['markdown.preview.linkify'])?.properties;
  if(!properties) throw new Error('markdown linkify setting not found'); properties['markdown.preview.linkify'].default=false; await writeFile(markdownPath,`${JSON.stringify(markdown,null,2)}\n`);
  const helperPath=path.join(sourceRoot,'extensions','emmet','src','imageSizeHelper.ts'); let helper=await readFile(helperPath,'utf8');
  helper=helper.replace("import * as path from 'path';","import * as path from 'path';\nimport { statSync } from 'fs';");
  helper=helper.replace("const reUrl = /^https?:/;","const reUrl = /^https?:/;\nconst allowedImageExtensions = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.tif', '.tiff', '.ico']);\nconst allowedDataMime = /^data:image\\/(?:png|jpeg|gif|webp|svg\\+xml|bmp|tiff|x-icon);base64,/i;\nconst maxImageBytes = 32 * 1024 * 1024;");
  const original="export function getImageSize(file: string): Promise<ImageInfoWithScale | undefined> {\n\tfile = file.replace(/^file:\\/\\//, '');\n\treturn reUrl.test(file) ? getImageSizeFromURL(file) : getImageSizeFromFile(file);\n}";
  const hardened="export function getImageSize(file: string): Promise<ImageInfoWithScale | undefined> {\n\tfile = file.replace(/^file:\\/\\//, '');\n\tif (reUrl.test(file)) { return Promise.reject(new Error('Remote image probing is disabled')); }\n\tif (file.startsWith('data:')) {\n\t\tif (!allowedDataMime.test(file) || file.length > maxImageBytes * 2) { return Promise.reject(new Error('Unsupported or oversized image data')); }\n\t} else if (!allowedImageExtensions.has(path.extname(file).toLowerCase())) { return Promise.reject(new Error('Unsupported image format')); }\n\treturn getImageSizeFromFile(file);\n}";
  if(!helper.includes(original)) throw new Error('Emmet helper changed upstream'); helper=helper.replace(original,hardened);
  helper=helper.replace("\t\timageSize(file, (err: Error | null, size?: ISizeCalculationResult) => {","\t\tif (statSync(file).size > maxImageBytes) { reject(new Error('Image exceeds size limit')); return; }\n\t\timageSize(file, (err: Error | null, size?: ISizeCalculationResult) => {");
  helper=helper.replace("import * as http from 'http';\n",'').replace("import * as https from 'https';\n",'').replace("import { URL } from 'url';\n",'');
  const start=helper.indexOf('/**\n * Get image size from given remove URL'); const end=helper.indexOf('/**\n * Returns size object',start); if(start<0||end<0) throw new Error('Emmet remote helper changed upstream'); helper=`${helper.slice(0,start)}${helper.slice(end)}`; await writeFile(helperPath,helper);
}

async function removeUnusedAgentSdkPackages(sourceRoot) {
  await rm(path.join(sourceRoot,'build','agent-sdk','agents','claude'),{recursive:true,force:true}); await rm(path.join(sourceRoot,'build','agent-sdk','agents','codex'),{recursive:true,force:true});
  const packagePath=path.join(sourceRoot,'package.json'); const packageJson=JSON.parse(await readFile(packagePath,'utf8')); for(const name of ['@anthropic-ai/claude-agent-sdk','@openai/codex']) delete packageJson.devDependencies?.[name]; await writeFile(packagePath,`${JSON.stringify(packageJson,null,2)}\n`);
  const lockPath=path.join(sourceRoot,'package-lock.json'); const lock=JSON.parse(await readFile(lockPath,'utf8')); for(const name of ['@anthropic-ai/claude-agent-sdk','@openai/codex']) delete lock.packages?.['']?.devDependencies?.[name]; for(const key of Object.keys(lock.packages||{})) if(key.startsWith('node_modules/@anthropic-ai/claude-agent-sdk')||key.startsWith('node_modules/@openai/codex')) delete lock.packages[key]; await writeFile(lockPath,`${JSON.stringify(lock,null,2)}\n`);
}
async function removeVendorAgentBuildHooks(sourceRoot) {
  const dirsPath=path.join(sourceRoot,'build','npm','dirs.ts'); await writeFile(dirsPath,(await readFile(dirsPath,'utf8')).replace(/^\s*'extensions\/copilot',\s*\n/m,''));
  const packagePath=path.join(sourceRoot,'package.json'); const value=JSON.parse(await readFile(packagePath,'utf8')); for(const name of ['compile-copilot','watch-copilot','watch-copilotd','copilot:setup','copilot:get_token']) delete value.scripts[name]; value.scripts.compile='npm run gulp compile'; value.scripts.watch=String(value.scripts.watch||'').replace(/\s+watch-copilot\b/g,''); value.scripts['watch-transpile']=String(value.scripts['watch-transpile']||'').replace(/\s+watch-copilot\b/g,''); await writeFile(packagePath,`${JSON.stringify(value,null,2)}\n`);
}
async function applySecurityLockOverrides(sourceRoot) { const overrides=JSON.parse(await readFile(path.join(overlayRoot,'security-lock-overrides.json'),'utf8')); for(const [relative,entries] of Object.entries(overrides.locks||{})){const target=path.join(sourceRoot,relative);const lock=JSON.parse(await readFile(target,'utf8'));for(const [packagePath,metadata] of Object.entries(entries)){if(metadata===null)delete lock.packages[packagePath];else lock.packages[packagePath]=metadata;}await writeFile(target,`${JSON.stringify(lock,null,2)}\n`);} }
async function copyRuntime(extensionTarget) { const runtime=path.join(extensionTarget,'runtime');await mkdir(runtime,{recursive:true});for(const directory of ['bibzcode','deepseek']){const source=path.join(repositoryRoot,directory),target=path.join(runtime,directory);await mkdir(target,{recursive:true});for(const name of await readdir(source))if(name.endsWith('.py'))await cp(path.join(source,name),path.join(target,name));}for(const name of ['requirements.txt','requirements-lock.txt','requirements-optional.txt','requirements-optional-lock.txt','pyproject.toml','LICENSE'])await cp(path.join(repositoryRoot,name),path.join(runtime,name)); }
async function copyBrandAssets(sourceRoot) { const assets=path.join(overlayRoot,'assets');for(const [from,to] of [['icon.png','resources/linux/code.png'],['icon.icns','resources/darwin/code.icns'],['icon.icns','resources/darwin/disk.icns'],['icon.ico','resources/win32/code.ico'],['icon-70.png','resources/win32/code_70x70.png'],['icon-150.png','resources/win32/code_150x150.png']]){const target=path.join(sourceRoot,to);await mkdir(path.dirname(target),{recursive:true});await cp(path.join(assets,from),target);} }
