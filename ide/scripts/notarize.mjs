import { notarize } from '@electron/notarize';

export default async function notarizeAfterSign(context) {
  if (process.platform !== 'darwin') return;
  const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID } = process.env;
  if (!APPLE_ID || !APPLE_APP_SPECIFIC_PASSWORD || !APPLE_TEAM_ID) {
    console.log('macOS notarization skipped: GitHub signing secrets are not configured.');
    return;
  }
  const appName = context.packager.appInfo.productFilename;
  await notarize({
    appBundleId: context.packager.appInfo.id,
    appPath: `${context.appOutDir}/${appName}.app`,
    appleId: APPLE_ID,
    appleIdPassword: APPLE_APP_SPECIFIC_PASSWORD,
    teamId: APPLE_TEAM_ID,
  });
}
