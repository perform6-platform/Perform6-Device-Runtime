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
requireText(css, 'width: 840px;', 'secondary shell width changed');
requireText(css, 'width: 756px;', 'secondary content rail changed');
requireText(css, 'white-space: nowrap !important;', 'supporting copy can wrap');
requireText(css, 'height: 633px;', 'Return-state shell height changed');
requireText(css, '.p6-video-playing-modal__controls { margin-top: 42px; }', 'Return-state action spacing changed');
requireText(css, 'grid-area: unset;', 'Start Here still inherits a grid-area offset');
requireText(css, '.p6-home__phase2 {\n  top: 783px;', 'Phase 2 geometry missing');
requireText(css, 'height: 245px;', 'home phase-card height changed');

const boxes = [
  ['Start Here', 491, 118, 938, 225],
  ['Phase 1', 94, 542, 816, 245],
  ['Phase 2', 94, 783, 816, 245],
  ['Full Program', 1010, 542, 816, 387],
  ['Self-Guided panel', 76, 430, 852, 624],
  ['Guided panel', 992, 430, 852, 528],
];

for (const [name, x, y, width, height] of boxes) {
  if (x < 0 || y < 0 || x + width > 1920 || y + height > 1080) {
    throw new Error(`Bluefin UI gate failed: ${name} escapes 1920x1080`);
  }
}

console.log('Bluefin UI gate passed: fixed canvas, Home bounds, shared rails, and Return-state rhythm verified.');
