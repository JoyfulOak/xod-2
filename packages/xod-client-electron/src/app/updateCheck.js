import fs from 'fs';
import path from 'path';
import https from 'https';

const STORE_FILE_NAME = 'update-check.json';
const GITHUB_LATEST_RELEASE_URL =
  'https://api.github.com/repos/JoyfulOak/xod-2/releases/latest';
const REQUEST_TIMEOUT_MS = 1500;

const normalizeVersion = version =>
  String(version || '')
    .trim()
    .replace(/^v/i, '');

const parseVersion = version => {
  const cleaned = normalizeVersion(version);
  const match = cleaned.match(
    /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
  );

  if (!match) return null;

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    preRelease: match[4] ? match[4].split('.') : [],
  };
};

const compareIdentifiers = (a, b) => {
  const isANumeric = /^\d+$/.test(a);
  const isBNumeric = /^\d+$/.test(b);

  if (isANumeric && isBNumeric) {
    const aNum = Number(a);
    const bNum = Number(b);
    if (aNum > bNum) return 1;
    if (aNum < bNum) return -1;
    return 0;
  }

  if (isANumeric && !isBNumeric) return -1;
  if (!isANumeric && isBNumeric) return 1;

  if (a > b) return 1;
  if (a < b) return -1;
  return 0;
};

const comparePreRelease = (aPre, bPre) => {
  const aEmpty = aPre.length === 0;
  const bEmpty = bPre.length === 0;

  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;

  const maxLength = Math.max(aPre.length, bPre.length);
  for (let i = 0; i < maxLength; i += 1) {
    const aId = aPre[i];
    const bId = bPre[i];

    if (aId === undefined) return -1;
    if (bId === undefined) return 1;

    const idCmp = compareIdentifiers(aId, bId);
    if (idCmp !== 0) return idCmp;
  }

  return 0;
};

const compareSemver = (aVersion, bVersion) => {
  const a = parseVersion(aVersion);
  const b = parseVersion(bVersion);

  if (!a || !b) return 0;

  if (a.major !== b.major) return a.major > b.major ? 1 : -1;
  if (a.minor !== b.minor) return a.minor > b.minor ? 1 : -1;
  if (a.patch !== b.patch) return a.patch > b.patch ? 1 : -1;

  return comparePreRelease(a.preRelease, b.preRelease);
};

const getStorePath = electronApp =>
  path.join(electronApp.getPath('userData'), STORE_FILE_NAME);

const readStore = electronApp => {
  const storePath = getStorePath(electronApp);

  try {
    if (!fs.existsSync(storePath)) return {};

    const text = fs.readFileSync(storePath, 'utf8');
    return JSON.parse(text);
  } catch (err) {
    return {};
  }
};

const writeStore = (electronApp, patch) => {
  const storePath = getStorePath(electronApp);
  const prev = readStore(electronApp);
  const next = { ...prev, ...patch };

  try {
    fs.writeFileSync(storePath, JSON.stringify(next, null, 2), 'utf8');
  } catch (err) {
    // Keep startup path resilient.
  }

  return next;
};

const fetchLatestRelease = () =>
  new Promise((resolve, reject) => {
    const request = https.get(
      GITHUB_LATEST_RELEASE_URL,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'xod-2-update-check',
        },
      },
      response => {
        const chunks = [];

        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => {
          if (response.statusCode !== 200) {
            reject(
              new Error(`Unexpected status code: ${String(response.statusCode)}`)
            );
            return;
          }

          try {
            const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            resolve(payload);
          } catch (err) {
            reject(err);
          }
        });
      }
    );

    request.on('error', reject);
    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error('Request timed out'));
    });
  });

export const checkForGithubUpdateOnceOnStartup = (
  electronApp,
  logger,
  onStatus = () => {}
) => {
  const currentVersion = normalizeVersion(electronApp.getVersion());
  const store = readStore(electronApp);
  const hasCachedLatestVersion = typeof store.latestVersion === 'string';
  const now = Date.now();
  const lastCheckAt = Number(store.lastUpdateCheckAt);
  const hasRecentCheck =
    Number.isFinite(lastCheckAt) && now - lastCheckAt < 6 * 60 * 60 * 1000;

  if (
    store.lastUpdateCheckVersion === currentVersion &&
    hasCachedLatestVersion &&
    hasRecentCheck
  ) {
    logger.debug('[update-check] skipped (already checked for this version)');
    onStatus({
      status: 'skipped',
      currentVersion,
      latestVersion: store.latestVersion,
      updateAvailable: Boolean(store.updateAvailable),
      releaseUrl: store.releaseUrl || null,
    });
    return;
  }

  logger.debug('[update-check] started');
  onStatus({ status: 'started', currentVersion });

  fetchLatestRelease()
    .then(release => {
      const latestVersion = normalizeVersion(release && release.tag_name);
      if (!latestVersion) {
        logger.debug('[update-check] failed (missing tag_name)');
        onStatus({ status: 'failed', currentVersion });
        return;
      }

      const hasUpdate = compareSemver(latestVersion, currentVersion) > 0;

      writeStore(electronApp, {
        lastUpdateCheckVersion: currentVersion,
        lastUpdateCheckAt: now,
        updateAvailable: hasUpdate,
        latestVersion,
        releaseUrl: release && release.html_url ? release.html_url : null,
      });

      if (hasUpdate) {
        logger.debug('[update-check] update available');
        onStatus({
          status: 'update-available',
          currentVersion,
          latestVersion,
          releaseUrl: release && release.html_url ? release.html_url : null,
        });
      } else {
        logger.debug('[update-check] no update');
        onStatus({ status: 'no-update', currentVersion, latestVersion });
      }
    })
    .catch(err => {
      if (err && err.message === 'Request timed out') {
        logger.debug('[update-check] timed out');
        onStatus({ status: 'timed-out', currentVersion });
      } else {
        logger.debug('[update-check] failed');
        onStatus({ status: 'failed', currentVersion });
      }
    });
};

export default checkForGithubUpdateOnceOnStartup;
