const { exec } = require('child_process');

const PLATFORM_EXECUTABLES = {
    'DeadByDaylight-Win64-Shipping.exe': 'steam',
    'DeadByDaylight-EGS-Shipping.exe': 'egs',
    'DeadByDaylight-WinGDK-Shipping.exe': 'ms_store',
};

function detectPlatform() {
    return new Promise((resolve) => {
        exec('tasklist /FO CSV /NH', {
            encoding: 'utf8',
            windowsHide: true,
            timeout: 5000,
        }, (err, stdout) => {
            if (err) {
                resolve({ detected: false, platform: null, exe: null });
                return;
            }

            for (const [exe, platform] of Object.entries(PLATFORM_EXECUTABLES)) {
                if (stdout.includes(exe)) {
                    resolve({ detected: true, platform, exe });
                    return;
                }
            }

            resolve({ detected: false, platform: null, exe: null });
        });
    });
}

module.exports = { detectPlatform };
