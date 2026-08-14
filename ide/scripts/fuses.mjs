import path from 'node:path';
import { flipFuses, FuseVersion, FuseV1Options } from '@electron/fuses';

export default async function hardenElectron(context) {
  const platform = context.electronPlatformName;
  const product = context.packager.appInfo.productFilename;
  const executableName = context.packager.executableName;
  let executable;
  if (platform === 'darwin') executable = path.join(context.appOutDir, `${product}.app`, 'Contents', 'MacOS', product);
  else if (platform === 'win32') executable = path.join(context.appOutDir, `${product}.exe`);
  else executable = path.join(context.appOutDir, executableName);

  await flipFuses(executable, {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
  });
  console.log(`Hardened Electron fuses: ${executable}`);
}
