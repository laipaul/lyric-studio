// Creates services/audio/.venv with Python 3.12 and installs requirements.txt into it.
import { spawnSync } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { PYTHON_VERSION, TORCH_VERSIONS, aiInstalledMarker, aiRequirementsFile, aiRequirementsHash, faceInstalledMarker, faceRequirementsFile, faceRequirementsHash, torchVariant, installedMarker, isWindows, pythonVersion, requirementsFile, requirementsHash, serviceDir, systemPython, venvDir, venvPython, dereverbInstalledMarker, dereverbRequirementsFile, dereverbRequirementsHash, aiReady } from "./common.mjs";

function run(cmd, args) {
  // Output goes to stderr so commands that print JSON on stdout (pnpm cuts) stay clean.
  const result = spawnSync(cmd, args, { stdio: ["inherit", process.stderr, process.stderr], cwd: serviceDir });
  if (result.status !== 0) {
    console.error(`[audio setup] failed: ${cmd} ${args.join(" ")}`);
    process.exit(result.status ?? 1);
  }
}

function failMissingPython() {
  const lines = [
    `[audio setup] Python ${PYTHON_VERSION} was not found ("${systemPython.label}" did not run).`,
    `[audio setup] The audio service needs exactly Python ${PYTHON_VERSION}; other versions are not used.`,
  ];
  if (isWindows) {
    lines.push(
      `[audio setup] Check what is installed with: py -0   (the list must include -V:${PYTHON_VERSION})`,
      `[audio setup] If it is missing, install Python ${PYTHON_VERSION} from https://www.python.org/downloads/windows/`,
    );
  } else {
    lines.push(`[audio setup] Install python${PYTHON_VERSION} with your system package manager.`);
  }
  lines.push("[audio setup] Then run: pnpm audio:setup");
  console.error(lines.join("\n"));
  process.exit(1);
}

export function setup() {
  if (!existsSync(venvPython) || pythonVersion(venvPython) !== PYTHON_VERSION) {
    const found = pythonVersion(systemPython.cmd, systemPython.args);
    if (found !== PYTHON_VERSION) failMissingPython();

    if (existsSync(venvDir)) {
      const old = existsSync(venvPython) ? pythonVersion(venvPython) : null;
      console.error(
        `[audio setup] removing old .venv (Python ${old ?? "unknown"}) to rebuild it with Python ${PYTHON_VERSION}`,
      );
      rmSync(venvDir, { recursive: true, force: true });
    }
    console.error(`[audio setup] creating ${venvDir} with ${systemPython.label}`);
    run(systemPython.cmd, [...systemPython.args, "-m", "venv", venvDir]);
  }
  console.error(`[audio setup] using Python ${pythonVersion(venvPython)} from .venv`);
  console.error("[audio setup] installing requirements (first time can take a few minutes)");
  // --only-binary: use ready-made wheels only, never compile anything from source.
  run(venvPython, [
    "-m", "pip", "install", "--disable-pip-version-check", "-q",
    "--only-binary=:all:",
    "-r", requirementsFile,
  ]);
  writeFileSync(installedMarker, requirementsHash());
  console.error("[audio setup] done");
}

// pnpm audio:setup --ai [--torch cpu|cu128]: PyTorch first (from the PyTorch index), then the pinned
// AI packages. Large download the first time (Windows CUDA build: about 3 GB).
export function setupAi(variantOverride) {
  setup();
  const variant = torchVariant(variantOverride);
  const pkgs = Object.entries(TORCH_VERSIONS).map(([name, version]) =>
    variant === "default" ? `${name}==${version}` : `${name}==${version}+${variant}`,
  );
  const index = variant === "default" ? [] : ["--index-url", `https://download.pytorch.org/whl/${variant}`];
  console.error(`[audio setup] installing PyTorch ${TORCH_VERSIONS.torch} (${variant === "cu128" ? "CUDA 12.8 build for NVIDIA GPUs" : variant === "cpu" ? "CPU build" : "default build"})`);
  console.error("[audio setup] this is a large download the first time (Windows CUDA build: about 3 GB)");
  run(venvPython, ["-m", "pip", "install", "--disable-pip-version-check", "--only-binary=:all:", ...index, ...pkgs]);
  console.error("[audio setup] installing the AI packages (WhisperX, Demucs)");
  run(venvPython, [
    "-m", "pip", "install", "--disable-pip-version-check", "-q",
    "--only-binary=:all:",
    "-r", aiRequirementsFile,
  ]);
  writeFileSync(aiInstalledMarker, `${aiRequirementsHash(variant)} ${variant}`);
  console.error("[audio setup] AI packages ready. Models download on first use into services/audio/models.");
}

// pnpm audio:setup --face: the local face checks for Characters (MediaPipe + OpenCV, about 120 MB; CPU only).
export function setupFace() {
  setup();
  console.error("[audio setup] installing the face check packages (MediaPipe, OpenCV)");
  run(venvPython, ["-m", "pip", "install", "--disable-pip-version-check", "-q", "--only-binary=:all:", "-r", faceRequirementsFile]);
  writeFileSync(faceInstalledMarker, faceRequirementsHash());
  console.error("[audio setup] face checks ready. The face models (about 52 MB) download on first use into services/audio/models/face.");
}

// pnpm audio:setup --dereverb: the de-reverb for the lip-sync drafts (UVR DeEcho-DeReverb via audio-separator), on top
// of the AI packages (PyTorch). The pinned versions stay: they are passed as constraints.
export function setupDereverb() {
  if (!aiReady()) {
    console.error("[audio setup] install the AI packages first: pnpm audio:setup --ai");
    process.exit(1);
  }
  console.error("[audio setup] installing the de-reverb (audio-separator)");
  run(venvPython, ["-m", "pip", "install", "--disable-pip-version-check", "-q", "-r", dereverbRequirementsFile, "-c", requirementsFile, "-c", aiRequirementsFile]);
  writeFileSync(dereverbInstalledMarker, dereverbRequirementsHash());
  console.error("[audio setup] de-reverb ready. Its model (about 120 MB) downloads on first use into services/audio/models/uvr.");
}

// Run directly (pnpm audio:setup [--ai] [--torch cpu|cu128]) rather than imported by run.mjs.
if (process.argv[1]?.endsWith("setup.mjs")) {
  const args = process.argv.slice(2);
  if (args.includes("--face")) {
    setupFace();
  } else if (args.includes("--dereverb")) {
    setupDereverb();
  } else if (args.includes("--ai")) {
    const t = args.indexOf("--torch");
    const variant = t >= 0 ? args[t + 1] : undefined;
    if (variant !== undefined && !["cpu", "cu128", "cu126", "default"].includes(variant)) {
      console.error("--torch must be cpu, cu128 or default");
      process.exit(1);
    }
    setupAi(variant);
  } else {
    setup();
  }
}
