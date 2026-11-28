# Setup on Windows 11

## 1. Install tools and obtain the approved checkout

Install Git for Windows, Node.js **24 LTS** with npm, Python **3.12** with the Windows launcher, and Arduino IDE **2.x** using their official installers. Open a new PowerShell window after installation. [Git](https://git-scm.com/install/windows) · [Node.js](https://nodejs.org/en/download) · [Python](https://www.python.org/downloads/windows/) · [Arduino IDE](https://www.arduino.cc/en/software)

```powershell
git --version
node --version
npm.cmd --version
py -3.12 --version
git clone https://github.com/m0o0nman/Vigil-IIAQ.git
Set-Location .\Vigil-IIAQ
git branch --all
git log -1 --oneline
```

The remote main branch was the onboarding baseline. Verify the checkout actually includes `web\package.json`, `firmware\VigilV2\VigilV2.ino` and this guide. The Phase 6 branch is local until authorized distribution. If the owner transfers a Git bundle, verify it before importing. The producer can create it from the approved local branch with `git bundle create Vigil-IIAQ-phase-6.bundle phase-6`. Transfer it privately, then run inside your clone:

```powershell
$Bundle = 'C:\path\to\Vigil-IIAQ-phase-6.bundle'
git bundle verify $Bundle
git fetch $Bundle phase-6:phase-6
git switch phase-6
git status --short
```

## 2. Set up offline Python and install the web dependencies

```powershell
$VigilVenv = Join-Path (Get-Location) 'firmware\build\python-venv'
py -3.12 -m venv $VigilVenv
& (Join-Path $VigilVenv "Scripts\python.exe") -m pip install "numpy==2.3.5"
& (Join-Path $VigilVenv "Scripts\python.exe") -m unittest discover -s training -v

Set-Location .\web
npm.cmd ci
Copy-Item .env.example .env.local
notepad.exe .env.local
```

Run the copy step once on a fresh checkout. Enter your own Firebase settings using the [configuration map](cloud_setup.md#environment-variable-map). Empty values are suitable for unit tests and a configuration-required page. The setup and tests need no activation script or PowerShell execution-policy change. Keep the approved Phase 1 files when validating a release. `python training/build.py` regenerates tracked specs and comparisons and is an optional reproduction step. Review its diff before committing any output. [Training provenance and regeneration](../training/comparison.md)

## 3. Run locally, test and build

From `web\`:

```powershell
npm.cmd run dev
```

Open `http://localhost:3000`. Keep the dev server in its own terminal and use another PowerShell window for tests. Confirm the Firebase Auth authorized domain includes `localhost` for your local project as applicable. Stop the dev server before a release build.

```powershell
npm.cmd test
npm.cmd run typecheck
$env:NEXT_TELEMETRY_DISABLED = '1'
npm.cmd run build
npm.cmd exec -- next start
```

The production entry point uses `next start` through npm because the repository has no `start` script. Public Firebase variables are read during the build. Rebuild after changing them. The build loads the bundled Syne Regular font. [Font troubleshooting](troubleshooting.md#syne-and-build-access)

## 4. Run the Linux host firmware checks if needed

The C++ oracle uses Linux facilities and the host test commands assume g++. On Windows, use an existing Linux/WSL environment with Python, g++, curl, and tar. Run from the approved checkout within the Linux shell. An Arduino IDE target build remains a separate step.

```sh
mkdir -p firmware/build
g++ -std=c++17 -Wall -Wextra -Werror firmware/tests/control.cpp -o firmware/build/control
firmware/build/control
python3 firmware/tests/acquisition.py
curl -fLsS https://codeload.github.com/bblanchon/ArduinoJson/tar.gz/refs/tags/v7.4.2 -o firmware/build/arduinojson.tgz
tar xzf firmware/build/arduinojson.tgz -C firmware/build
g++ -std=c++17 -Wall -Wextra -Werror -Ifirmware/build/ArduinoJson-7.4.2/src firmware/tests/reply.cpp -o firmware/build/reply
firmware/build/reply
```

Vitest checks the committed golden vectors directly. Optional regeneration of the C++ oracle output uses `python3 training/vectors.py` in Linux with NumPy and g++ available. Rebuilding the sketch for the real board and collecting browser screenshots are covered separately. [Arduino steps](esp32_setup.md) · [Browser harness and fixtures](interface_redesign.md#verification)
