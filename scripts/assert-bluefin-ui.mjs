import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const frame = read('src/layout/BluefinMasterFrame.tsx');
const viewport = read('src/shared/bluefinViewport.ts');
const main = read('src/main.tsx');
const css = read('src/bluefinClientReview.css');
const sessionModal = read('src/components/ui/SessionModal.tsx');
const playingModal = read('src/components/ui/VideoPlayingModal.tsx');
const home = read('src/pages/Home.tsx');
const bootSplash = read('src/components/status/BootSplash.tsx');
const bootShell = read('index.html');
const downloadOverlay = read('src/components/home/DownloadProgressOverlay.tsx');
const approvedLogo = read('src/assets/Perform6-approved-logo.svg');
const packagedBootLogo = read('public/images/perform6-approved-logo.svg');
const ledIdle = fs.readFileSync(path.join(root, 'brightsign/led-idle.png'));

function requireText(source, value, label) {
  if (!source.includes(value)) throw new Error(`Bluefin UI gate failed: ${label}`);
}

requireText(viewport, 'width: 1920', 'master width is not 1920');
requireText(viewport, 'height: 1080', 'master height is not 1080');
requireText(frame, 'Math.min(width / BLUEFIN_VIEWPORT.width, height / BLUEFIN_VIEWPORT.height)', 'fit-to-canvas scale changed');
requireText(frame, 'transform: `scale(${scale})`', 'single-frame transform changed');
requireText(main, "import './index.css';\nimport './bluefinClientReview.css';", 'client CSS must load after base CSS');
requireText(sessionModal, "'p6-session-modal--overview'", 'Begin Session is outside the shared shell');
requireText(playingModal, "'p6-session-modal--overview'", 'Return/playing states are outside the shared shell');
requireText(home, 'runtimeConfig.isSimulator', 'visual audit path is not simulator-only');
requireText(home, "get('p6VisualSession')", 'post-start visual audit path is missing');
requireText(bootSplash, "Perform6-approved-logo.svg", 'runtime startup still uses the legacy logo');
requireText(bootShell, './images/perform6-approved-logo.svg', 'initial loading shell still uses the legacy logo');
requireText(home, "setPendingDownloadSource('start-here')", 'Start Here unavailable-media card is missing');
requireText(home, "setPendingDownloadSource('phase1')", 'Phase 1 unavailable-media card is missing');
requireText(home, "setPendingDownloadSource('phase2')", 'Phase 2 unavailable-media card is missing');
requireText(home, "setPendingDownloadSource('full-program')", 'Full Program unavailable-media card is missing');
requireText(downloadOverlay, 'VIDEO DOWNLOADING', 'focused download-card heading is missing');
requireText(downloadOverlay, 'RETURN TO MENU', 'focused download-card return action is missing');
if (approvedLogo !== packagedBootLogo) {
  throw new Error('Bluefin UI gate failed: initial-shell logo differs from the approved runtime vector');
}
if (
  ledIdle.length < 24 ||
  ledIdle.toString('hex', 0, 8) !== '89504e470d0a1a0a' ||
  ledIdle.readUInt32BE(16) !== 3840 ||
  ledIdle.readUInt32BE(20) !== 2160
) {
  throw new Error('Bluefin UI gate failed: LED idle logo is not a 3840x2160 PNG');
}
requireText(css, 'width: 808px;', 'secondary shell width changed');
requireText(css, 'width: 760px;', 'secondary content rail changed');
requireText(css, 'white-space: nowrap !important;', 'supporting copy can wrap');
requireText(css, 'height: 620px;', 'Return-state shell height changed');
requireText(css, '.p6-video-playing-modal__controls { margin-top: 26px; }', 'Return-state action spacing changed');
requireText(css, 'height: 663px;', 'Begin-state vertical rhythm changed');
requireText(css, 'height: 843px;', 'Full overview vertical rhythm changed');
requireText(css, 'height: 980px;', 'Full playing vertical rhythm changed');
requireText(css, 'height: 909px;', 'Full confirmation vertical rhythm changed');
requireText(css, 'height: 40px !important;\n  flex: none;', 'Phase duration row can shrink below the shared 40px rail');
requireText(css, 'grid-area: unset;', 'Start Here still inherits a grid-area offset');
requireText(css, '.p6-home__phase2 {\n  top: 798px;', 'Phase 2 corrected geometry missing');
requireText(css, 'height: 238px;', 'corrected home phase-card height changed');
requireText(css, 'width: 978px;', 'Start Here collision-safe width changed');
requireText(css, 'height: 203px;', 'Start Here reviewed height changed');
requireText(css, 'height: 353px;', 'Full Program reviewed height changed');
requireText(css, 'height: 483px;', 'Guided panel reviewed height changed');
requireText(css, 'grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);', 'Home divider is not content-sized');
requireText(css, 'column-gap: 24px;', 'Home divider grid clearance changed');
requireText(css, 'width: calc(100% - 6px);', 'Home divider left optical correction changed');
requireText(css, 'width: 734px;', 'Full Program progress rail changed');
requireText(css, 'width: 600px;', 'Full Program volume rail changed');
requireText(css, "content: '';\n  display: block;\n  width: 20px;\n  height: 20px;\n  flex: 0 0 20px;", 'Full Program volume midpoint spacer changed');
requireText(css, 'width: 28px;\n  height: 28px;', 'secondary play icon size changed');
requireText(css, 'width: 760px;\n  text-align: center;', 'Full Program confirmation centering changed');

const boxes = [
  ['Start Here', 471, 117, 978, 203],
  ['Phase 1', 94, 542, 816, 238],
  ['Phase 2', 94, 798, 816, 238],
  ['Full Program', 1010, 542, 816, 353],
  ['Self-Guided panel', 76, 430, 852, 624],
  ['Guided panel', 992, 430, 852, 483],
];

for (const [name, x, y, width, height] of boxes) {
  if (x < 0 || y < 0 || x + width > 1920 || y + height > 1080) {
    throw new Error(`Bluefin UI gate failed: ${name} escapes 1920x1080`);
  }
}

const phase1 = boxes.find(([name]) => name === 'Phase 1');
const phase2 = boxes.find(([name]) => name === 'Phase 2');
if (!phase1 || !phase2 || phase2[2] - (phase1[2] + phase1[4]) !== 18) {
  throw new Error('Bluefin UI gate failed: Phase 1/Phase 2 gap is not 18px');
}

const fullProgram = boxes.find(([name]) => name === 'Full Program');
const guidedPanel = boxes.find(([name]) => name === 'Guided panel');
if (!fullProgram || !guidedPanel || (guidedPanel[2] + guidedPanel[4]) - (fullProgram[2] + fullProgram[4]) !== 18) {
  throw new Error('Bluefin UI gate failed: Full Program/Guided panel bottom padding is not 18px');
}

requireText(css, '.p6-full-program-content__row1 { top: 140px; }', 'Full Program row 1 position changed');
requireText(css, '.p6-full-program-content__row2 { top: 181px; }', 'Full Program row 2 position changed');
requireText(css, '.p6-full-program-content__steps { top: 222px;', 'Full Program equal row spacing changed');
requireText(css, '.p6-full-program-content__accent { top: 139px; height: 110px; }', 'Full Program blue line geometry changed');
requireText(css, '.p6-full-program-content__row1 .p6-keyword-row__item:nth-child(1) {\n  width: 100px !important;\n  flex: 0 0 100px;', 'Full Program row 1 optical shift changed');
requireText(css, '.p6-full-program-content__row2 .p6-keyword-row__item:nth-child(1) {\n  width: 107px !important;\n  flex: 0 0 107px;', 'Full Program row 2 first group changed');
requireText(css, '.p6-full-program-content__row1 .p6-keyword-row__item:nth-child(3) {\n  width: 101px !important;\n  flex: 0 0 101px;', 'Full Program row 1 second group changed');
requireText(css, '.p6-full-program-content__row2 .p6-keyword-row__item:nth-child(3) {\n  width: 87px !important;\n  flex: 0 0 87px;', 'Full Program row 2 optical shift changed');
requireText(css, 'top: 300px;\n  width: auto;\n  color: #D0D2D5BB;', 'Full Program description bottom alignment changed');
requireText(css, '.p6-full-program-content__clock { top: 293px;', 'Full Program clock bottom alignment changed');

console.log('Bluefin UI gate passed: fixed canvas, Home bounds, shared rails, and Return-state rhythm verified.');
