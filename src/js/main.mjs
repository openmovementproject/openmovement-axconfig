// Form for input details
// Save config to localstorage?
// Check battery and configuration status?
// Barcode/QR-code read?
// Save log to localstorage (and sync)?

// Extract last 9 digits:
//   parseInt('0' + id.replace(/[^0-9]/g, '').slice(-9))
//
// Extract last 9 alphanumeric characters convert non-numeric to '0':
//   parseInt('0' + id.replace(/[^A-Za-z0-9]/g, '').replace(/[^0-9]/g, '0').slice(-9))

/*
Linux: USB devices typically read-only for non-root users.

Add a new udev rule by creating a file at `/etc/udev/rules.d/07-cwa.rules`:

```bash
SUBSYSTEM=="usb", ATTR{idVendor}=="04d8", ATTR{idProduct}=="0057", MODE="0664", GROUP="plugdev"
```

Add the user to the `plugdev` group: `sudo adduser pi plugdev`

# /lib/udev/rules.d/60-serial.rules
# ls /dev/serial/by-id

#sudo udevadm control --reload-rules && udevadm trigger
#lsusb -v -d 04d8:0057


# chromium-browser --disable-webusb-security
*/
/*
// Windows Chrome WebUSB Back-end:  chrome://flags/#new-usb-backend
*/

import { redirectConsole, watchParameters, localTimeString, localTimeValue, download } from './util.mjs';
import KeyInput from './key_input.mjs';
import DeviceManager from './device_manager.mjs';
import Barcode from './barcode.mjs';
import { parseHeader, parseData } from './cwa_parse.mjs';

window.addEventListener("error", function (e) {
    document.getElementById('warnings').appendChild(document.createTextNode('⚠️ Unhandled error.'));
    console.log("ERROR: Unhandled error: " + (e.error && e.error.message ? e.error.message : e.error));
    console.log(JSON.stringify(e));
    return false;
});

window.addEventListener("unhandledrejection", function (e) {
    document.getElementById('warnings').appendChild(document.createTextNode('⚠️ Unhandled promise rejection.'));
    console.log("ERROR: Unhandled rejection: " + (e.error && e.error.message ? e.error.message : e.error));
    console.log(JSON.stringify(e));
    return false;
});

let globalParams = {};
let showDebug = false;
let domLoaded = false;
let allowUsb = true;
let allowSerial = true;
let version = null;

// Don't redirect console unless debug view is enabled (will require refresh if #debug added)
let redirected = false;
function redirect() {
    if (!redirected) {
        redirectConsole('#output');
        redirected = true;
    }
    if (domLoaded) { document.querySelector('body').classList.toggle('console', showDebug); }
}
watchParameters(parametersChanged);
if (showDebug) { redirect(); }


// Service Worker Registration
if ('serviceWorker' in navigator) {
    // Wait until page is loaded
    window.addEventListener('load', async function() {
        try {
            // Load 'service-worker.js', must be in a top-level directory.
            const serviceWorkerFile = 'service-worker.js';
            const reg = await navigator.serviceWorker.register(serviceWorkerFile);
            // If service-worker.js changes...
            reg.onupdatefound = function() {
                const installing = reg.installing;
                installing.onstatechange = function() {
                    switch (installing.state) {
                        case 'installed':
                            if (navigator.serviceWorker.controller) {
                                console.log('SERVICEWORKER: New content available.');
                                if (confirm('[ServiceWorker] Update available -- reload now?')) {
                                    window.location.reload();
                                }
                            } else {
                                console.log('SERVICEWORKER: Now available offline.');
                            }
                            break;
                        case 'redundant':
                            console.log('SERVICEWORKER: Installing worker was redundant.');
                            break;
                    }
                };
            };
        } catch (e) {
            console.log('SERVICEWORKER: Error during registration: ' + e);
        }
    });
}

// Old appcache
if (window.applicationCache) {
    applicationCache.addEventListener('updateready', function() {
        if (confirm('[AppCache] Update available -- reload now?')) {
            window.location.reload();
        }
    });
}



let currentDevice = null;
let lastConfig = {};
let disconnectClearCode = false;
let deviceManager = null;
let keyInput = null;
let autoSubmit = true;
let scanReaders = 'code_128'; // 'code_128,ean_8' // 'code_128,ean,ean_8,code_39,code_39_vin,codabar,upc,upc_e,i2of5,2of5,code_93'
const codeInput = '#code';

//const RELATIVE_CUTOFF = 946684800 * 1000;   // 2000-01-01 (treat as relative time if smaller than this)

function parametersChanged(params = globalParams) {
    globalParams = params;
    console.log('PARAMS: ' + JSON.stringify(params));

    if (typeof params.nodebug !== 'undefined') showDebug = false;
    if (typeof params.debug !== 'undefined') showDebug = true;
    if (showDebug) { redirect(); }

    if (typeof params.allowserial !== 'undefined') allowSerial = true;
    if (typeof params.noserial !== 'undefined') allowSerial = false;

    if (typeof params.allowusb !== 'undefined') allowUsb = true;
    if (typeof params.nousb !== 'undefined') allowUsb = false;

    // Everything else here requires DOM
    if (!domLoaded) return;

    let readonly = false; // default
    if (typeof params.editable !== 'undefined') readonly = false;
    if (typeof params.readonly !== 'undefined') readonly = true;
    for (let input of ['#session', '#rate', '#range', '#gyro', '#start', '#delay', '#duration', '#stop', '#metadata', '#minbattery']) {
        const elem = document.querySelector(input);
        if (readonly) {
            elem.setAttribute('disabled', 'true');
        } else {
            elem.removeAttribute('disabled');
        }
    }

    let details = true; // default
    if (typeof params.details !== 'undefined') details = true;
    if (typeof params.nodetails !== 'undefined') details = false;
    if (details) {
        document.querySelector('#details').setAttribute('open', 'true');
    } else {
        document.querySelector('#details').removeAttribute('open');
    }

    const newConfig = {
        session: null,
        rate: 100,
        range: 8,
        gyro: 0,
        start: 0,
        stop: 168,
        metadata: '',
    };
    let changedConfig = false;
    for (let part of ['session', 'rate', 'range', 'gyro', 'start', 'stop', 'metadata', 'minbattery']) {
        if (typeof params[part] !== 'undefined') { newConfig[part] = params[part]; }
        changedConfig |= (typeof newConfig[part] !== typeof lastConfig[part] || newConfig[part] == lastConfig[part]);
    }

    if (changedConfig) {
        lastConfig = newConfig;
        console.log('PARAMS: Config changed: ' + JSON.stringify(newConfig));
        updateForm(newConfig);
    } else {
        console.log('PARAMS: Config not changed: ' + JSON.stringify(newConfig));
    }

    if (params.config) {
        keyInput.setValue(params.config);
    }

    if (typeof params.focus !== 'undefined') {
        document.querySelector('#code').select();
        document.querySelector('#code').focus();
    }
   
    codeChanged(document.querySelector('#code').value);

    document.querySelector('#add_usb_device').setAttribute('style', allowUsb ? 'display: inline;' : 'display: none;');
    document.querySelector('#add_serial_device').setAttribute('style', allowSerial ? 'display: inline;' : 'display: none;');

    // Always remove when not supported
    if (!navigator.serial) {
        document.querySelector('#add_serial_device').setAttribute('style', 'display: none;');
    }

    // Disable log/log-clear
    document.querySelector('body').classList.toggle('nolog', typeof params.nolog !== 'undefined');
    document.querySelector('body').classList.toggle('nologclear', typeof params.nologclear !== 'undefined');

    // Disable configuration
    document.querySelector('body').classList.toggle('no-configure', typeof params.noconfigure !== 'undefined');
    if (typeof params.diagnostics !== 'undefined') {
        document.querySelector('body').classList.add('diagnostics-open');
    }

    document.querySelector('#add_usb_device').setAttribute('style', allowUsb ? 'display: inline;' : 'display: none;');

    // Barcode scanning
    let allowScan = true;
    if (typeof params.noscan !== 'undefined') allowScan = false;
    if (typeof params.scan !== 'undefined') allowScan = true;
    document.querySelector('body').classList.toggle('allow-scan', allowScan);
    if (typeof params.readers !== 'undefined') scanReaders = params.readers;

    // Keyboard (external barcode scanner) auto-submit
    if (typeof params.autosubmit !== 'undefined') autoSubmit = true;
    if (typeof params.noautosubmit !== 'undefined') autoSubmit = false;
    keyInput.setAutoSubmit(autoSubmit);

    let title = null;
    if (typeof params.title !== 'undefined') title = params.title;
    if (!title) title = 'AX Configure';
    document.querySelector('title').innerText = title;
    document.querySelector('#title').innerText = title;
}


const updateForm = (config) => {
    document.querySelector('#session').value = typeof config.session !== 'undefined' ? config.session : '';
    document.querySelector('#rate').value = typeof config.rate !== 'undefined' ? config.rate : '';
    document.querySelector('#range').value = typeof config.range !== 'undefined' ? config.range : '';
    document.querySelector('#gyro').value = typeof config.gyro !== 'undefined' ? config.gyro : '';
    document.querySelector('#minbattery').value = typeof config.minbattery !== 'undefined' ? config.minbattery : '';

    let start = parseDate(config.start);
    if (!start) {
        document.querySelector('#delay').value = (!config.start && config.start !== 0) ? '' : config.start;
        delayChanged();
    } else {
        document.querySelector('#start').value = localTimeString(start, 'm') || '';
        startChanged();
    }

    let stop = relativeTime(config.stop, localTimeValue(document.querySelector('#start').value));
    if (stop === null) {
        document.querySelector('#stop').value = document.querySelector('#start').value;
    } else {
        document.querySelector('#stop').value = localTimeString(stop, 'm') || '';
    }
    stopChanged();
    //durationChanged(0);

    document.querySelector('#metadata').value = typeof config.metadata !== 'undefined' ? config.metadata : '';
    updateEnabled();
}


function getWarnings(config) {
    const warnings = [];

    // Warning: start time is in the past
    const now = new Date();
    if (config.stop.getTime() < now) {
        warnings.push('Recording interval has already finished.');
    } else if (config.start.getTime() + 66 * 1000 < now) {
        warnings.push('Recording interval has already started.');
    } else if (config.start.getTime() <= now) {
        //warnings.push('Recording interval is starting immediately.');
    }

    // Warning: start time is a long time in the future
    if (config.start.getTime() > now + 21 * 24 * 60 * 60 * 1000) {
        warnings.push('Start time is a long time in the future.');
    }

    // Warning: chosen start and stop does not make an interval
    const duration = (config.stop.getTime() - config.start.getTime()) / 1000;
    if (duration <= 0) {
        warnings.push('Start/stop times do not make an interval.');
    }

    // Warning: large recording durations
    // AX3 packed 119009040 samples; AX3 unpacked 79339360 samples; AX6 accel. only 158714880 samples; AX6 accel. + gyro. 79357440 samples
    if (duration * config.rate > 158714880) {
        warnings.push('Duration is too long (for this rate).');
    }

    // Warning: frequency invalid
    if (![6, 6.25, 12, 12.5, 25, 50, 100, 200, 400, 800, 1600, 3200].includes(config.rate)) {
        warnings.push('Rate is not valid.');
    }

    // Battery warning is given at configuration time
    
    return warnings;
}


const updateEnabled = () => {
    //const code = document.querySelector(codeInput).value;
    
    let config = null;
    try {
        config = configFromForm();
        //console.log(JSON.stringify(config, null, 4));
        const warnings = getWarnings(config);
        if (warnings && warnings.length > 0) {
            setResult('WARNING: ' + warnings.join('; '), true);
        } else {
            setResult('', false);
        }
        console.log('CONFIG-VALID: true');
        document.querySelector('body').classList.add('config-valid');
    } catch (e) {
        //console.log('CONFIGURATION: ' + e);
        setResult(e, true);
        console.log('CONFIG-VALID: false');
        document.querySelector('body').classList.remove('config-valid');
    }

    const enabled = config && !!currentDevice && !isConfiguring; // && code.length > 0
    keyInput.submitEnabled(enabled);
}

function updateDiagnostics() {
    const isRunningDiagnostic = document.querySelector('body').classList.contains('running-diagnostic');
    const hasDevice = document.querySelector('body').classList.contains('device-connected');
    const hasDiagnostic = document.querySelector('#diagnostic-text').value.startsWith('{');

    console.log('DIAGNOSTICS: Update with device: ' + hasDevice + ' and diagnostic: ' + hasDiagnostic);

    if (hasDevice && !isRunningDiagnostic) {
        document.querySelector('#diagnostic-run').removeAttribute('disabled');
        document.querySelector('#diagnostic-data-download').removeAttribute('disabled');
        document.querySelector('#diagnostic-reset').removeAttribute('disabled');
    } else {
        document.querySelector('#diagnostic-run').setAttribute('disabled', "true");
        document.querySelector('#diagnostic-data-download').setAttribute('disabled', "true");
        document.querySelector('#diagnostic-reset').setAttribute('disabled', "true");
    }

    if (hasDiagnostic) {
        document.querySelector('#diagnostic-copy').removeAttribute('disabled');
        document.querySelector('#diagnostic-download').removeAttribute('disabled');
    } else {
        document.querySelector('#diagnostic-copy').setAttribute('disabled', "true");
        document.querySelector('#diagnostic-download').setAttribute('disabled', "true");
    }
}

const updateStatus = () => {
    let status = {
        deviceType: null,
        deviceId: '-',
        battery: '-',
        state: null,
        errorState: null,
    };

    currentDevice = deviceManager.getSingleDevice();
    if (currentDevice) {
        status.deviceId = currentDevice.serial || ((currentDevice.status && currentDevice.status.id && currentDevice.status.id.deviceId) ? currentDevice.status.id.deviceId : '-');
        if (currentDevice.status && currentDevice.status.id && currentDevice.status.id.deviceType) {
            status.deviceType = currentDevice.status.id.deviceType;
        } else if (currentDevice.deviceType) {
            status.deviceType = currentDevice.deviceType;
        }
        if (currentDevice.status.battery !== null) {
            status.battery = currentDevice.status.battery.percent;
        }
        status.state = currentDevice.status.state;
        status.errorState = currentDevice.status.errorState;

        document.querySelector('body').classList.add('device-connected');
    } else {
        document.querySelector('body').classList.remove('device-connected');
    }
    updateDiagnostics();

    document.querySelector('#device-id').value = status.deviceId + (status.deviceType ? ' [' + status.deviceType + ']' : '');
    document.querySelector('#battery-meter').value = Number.isNaN(parseInt(status.battery)) ? 0 : parseInt(status.battery);
    document.querySelector('#battery').value = Number.isNaN(parseInt(status.battery)) ? '-' : status.battery + "%";
    document.querySelector('#state').value = status.state || status.errorState || '-';

    if (currentDevice && currentDevice.status && currentDevice.status.recordingStarted) {
        // Recording started
        document.querySelector('#configure').value = '⚠️ Delete device data and reconfigure';
    } else if (currentDevice && currentDevice.status && currentDevice.status.recordingConfigured) {
        // Configured but not started
        document.querySelector('#configure').value = '🔁 Reconfigure';
    } else {
        // Not configured (or no device)
        document.querySelector('#configure').value = 'Configure';
    }

    updateEnabled();
}

const deviceChanged = async () => {
    diagnosticClear();

    currentDevice = deviceManager.getSingleDevice();

    if (!currentDevice) {
        console.log('DEVICECHANGED: (none)');

        // Simulate a reconfigure when a device is removed after successful programming...
        if (disconnectClearCode) {
            disconnectClearCode = false;
            reconfigure(true, true);
        }

        await updateStatus();
    } else {
        console.log('DEVICECHANGED: ' + (currentDevice.serial ? currentDevice.serial : '<no serial>'));
        currentDevice.setStatusHandler(updateStatus);
        console.log('DEVICECHANGED: updateStatus...');
        try {
            await currentDevice.updateStatus();
            console.log('STATUS: ' + JSON.stringify(currentDevice.status));
            //updateStatus();
        } catch(e) {
            console.log('DEVICECHANGED: ERROR: ' + JSON.stringify(e));
            //setResult(e, true);
        }
    }
}

const parseDate = (time) => {
    if (!time && time !== 0) return null;
    if (time && Object.prototype.toString.call(time) === "[object Date]" && !isNaN(time)) {
        return time;
    }
    if (/\d\d\d\d-\d\d-\d\d[T ]\d\d:\d\d:\d\d(?:\.\d\d\d)?Z?/.test(time)) {
        try {
            let date;
            if (time[time.length - 1] == 'Z') {
                date = new Date(time);
            } else {
                const dateParts = time.split(/\D/).map(part => parseInt(part));
                dateParts[1] = dateParts[1] - 1; // month
                date = new Date(...dateParts);
            }
            return date;
        } catch (e) {
            console.log('ERROR: Problem parsing date: ' + time);
        }
    }
    return null;
}

const relativeTime = (time, relativeTo, unitScale = 60 * 60 * 1000) => {
    if (!time && time !== 0) return null;
    const date = parseDate(time);
    if (date) {
        return date;
    }
    relativeTo = (!relativeTo && relativeTo !== 0) ? (new Date()) : relativeTo;
    return new Date(relativeTo.getTime() + parseFloat(time) * unitScale);
}

const getDuration = () => {
    if (document.querySelector('#duration').value === '') return null;
    const hours = parseFloat(document.querySelector('#duration').value);
    return hours * 60 * 60 * 1000;
}

const startChanged = () => {
    // Stop using delay
    const start = localTimeValue(document.querySelector('#start').value);
    document.querySelector('#delay').value = '';
    durationChanged();
}

const delayChanged = (delayValue = null) => {
    // Update start
    if (Number(delayValue) === delayValue) {
        document.querySelector('#delay').value = delayValue;
    }
    const delay = document.querySelector('#delay').value;
    if (delay.trim() !== '') {
        const now = new Date();
        const milliseconds = parseFloat(delay) * 60 * 60 * 1000;
        let start;
        if (milliseconds >= 0) {
            // Positive: Time from now
            start = new Date(now.getTime() + milliseconds);
        } else {
            // Negative: Local time of the previous midnight
            const midnight = new Date((new Date(now)).setHours(0,0,0,0))
            start = new Date(midnight.getTime() + -milliseconds);
        }
        const elem = document.querySelector('#start');
        const newValue = localTimeString(start, 'm');
//console.log("DELAY CHANGED?: " + parseFloat(delay) + " -> " + newValue);
        if (elem.value != newValue) {
            //console.log("UPDATE: Start updated to current time (delay " + parseFloat(delay) + " hrs): " + newValue)
            elem.value = newValue;
            durationChanged();
        }
    }
}

const stopChanged = () => {
    // Recalculate duration
    const start = localTimeValue(document.querySelector('#start').value);
    const stop = localTimeValue(document.querySelector('#stop').value);
    if (stop === null || start === null) {
        document.querySelector('#duration').value = '';
        return;
    }
    const duration = stop.getTime() - start.getTime();
    const hours = duration / 1000 / 60 / 60;
    document.querySelector('#duration').value = hours;
}

const durationChanged = (duration) => {
    if (Number(duration) === duration) {
        const hours = duration / 1000 / 60 / 60;
        document.querySelector('#duration').value = hours;
    }
    // Recalculate stop
    const start = localTimeValue(document.querySelector('#start').value);
    if (start) {
        const durationValue = getDuration();
        const stop = new Date(start.getTime() + durationValue);
        document.querySelector('#stop').value = localTimeString(stop, 'm');
    } else {
        document.querySelector('#stop').value = document.querySelector('#start').value;
    }
}

const configFromForm = () => {
    const config = {
        session: document.querySelector('#session').value == '' ? null : parseInt(document.querySelector('#session').value),
        rate: parseFloat(document.querySelector('#rate').value),
        range: parseInt(document.querySelector('#range').value),
        gyro: parseInt(document.querySelector('#gyro').value),
        start: localTimeValue(document.querySelector('#start').value),
        stop: localTimeValue(document.querySelector('#stop').value),
        metadata: document.querySelector('#metadata').value,
        minbattery: document.querySelector('#minbattery').value == '' ? null : parseInt(document.querySelector('#minbattery').value),
    };

    const notSpecified = [];
    if (typeof config.session !== 'number' || isNaN(config.session)) notSpecified.push('session ID not specified');
    if (typeof config.start !== 'object' || !config.start) notSpecified.push('start time not specified');
    if (typeof config.stop !== 'object' || !config.stop) notSpecified.push('stop time not specified');
    if (getDuration() <= 0) { notSpecified.push('start and stop times do not make a valid interval'); }
    if (notSpecified.length > 0) {
        throw "Cannot configure: " + notSpecified.join(', ') + '.';
    }
    return config;
}

const extractMetadata = (metadata, id) => {
    if (metadata.length > 0 && metadata[0] == '?') { metadata = metadata.slice(1); }
    const parts = metadata.split('&');
    for (let part of parts) {
        const equals = part.indexOf('=');
        const key = decodeURIComponent((equals >= 0) ? part.slice(0, equals) : part).replace(/\+/g, ' ');
        if (key.length <= 0) continue;
        if (key == id) {
            const value = decodeURIComponent((equals >= 0) ? part.slice(equals + 1) : '').replace(/\+/g, ' ');
            return value;
        }
    }
    return null;
}

const upsertMetadata = (metadata, id, newValue) => {
    if (metadata.length > 0 && metadata[0] == '?') { metadata = metadata.slice(1); }
    const parts = metadata.split('&');
    const components = [];
    let found = false;
    for (let part of parts) {
        const equals = part.indexOf('=');
        const key = decodeURIComponent((equals >= 0) ? part.slice(0, equals) : part).replace(/\+/g, ' ');
        if (key.length <= 0) continue;
        //const value = decodeURIComponent((equals >= 0) ? part.slice(equals + 1) : '').replace(/\+/g, ' ');
        if (key == id) {
            if (!found) {
                found = true;
                if (newValue !== null) {
                    components.push(encodeURIComponent(key) + '=' + encodeURIComponent(newValue));
                }
            }
            // else ignore repeated value
        } else {
            components.push(part);
        }
    }
    if (!found && newValue !== null) {
        components.push(encodeURIComponent(id) + '=' + encodeURIComponent(newValue));
    }
    return components.join('&');
}

const clearConfig = () => {
    //console.log('Clearing config...');
    const config = {
        session: null,
        rate: 100,
        range: 8,
        start: 0,
        stop: null,
        metadata: '',
    }
    updateForm(config);
}

const setResult = (value, error = false) => {
    const elem = document.querySelector('#result');
    if (error) {
        elem.value = '⚠️ ' + value;
    } else {
        elem.value = value;
    }
}

const codeChanged = (code) => {
    console.log('CODE: ' + code);

    // Extract last 9 digits:
    const sessionId = code.trim().length > 0 ? parseInt('0' + code.replace(/[^0-9]/g, '').slice(-9)) : '';
    //
    // Extract last 9 alphanumeric characters convert non-numeric to '0':
    //const sessionId = parseInt('0' + code.replace(/[^A-Za-z0-9]/g, '').replace(/[^0-9]/g, '0').slice(-9))
    document.querySelector('#session').value = sessionId;

    document.querySelector('#metadata').value = upsertMetadata(document.querySelector('#metadata').value, '_sc', code.length == 0 ? null : code);
    
    updateEnabled();
};

const configMismatches = (desired, actual) => {
    const ignoreList = ['minbattery'];
    const mismatches = [];
    for (let key of Object.keys(desired)) {
        if (ignoreList.includes(key)) continue;
        if (!key in actual) {
            console.log(`ERROR: Configuration key not found: ${key}`);
            mismatches.push([{[key]: desired[key]}, null]);
        } else if (desired[key] != actual[key]) {
            console.log(`ERROR: Configuration value not matched for '${key}': ${desired[key]} != ${actual[key]}.`);
            mismatches.push([{[key]: desired[key]}, {[key]: actual[key]}]);
        }
    }
    return mismatches;
}


const logPrefix = 'LOG_';

const logRecord = (resultLabel, status) => {
    let elements = [];

    // format: yyyy-MM-dd HH:mm:ss
    // type: AX3-CONFIG-OK | AX3-CONFIG-ERROR
    // timeNow,type,deviceId,sessionId,start,stop,frequency,range,"metadata"

    // Current UTC time
    //const now = new Date();
    //const timestamp = now.getFullYear() + '-' + ('0' + (now.getMonth()+1)).slice(-2) + '-' + ('0' + now.getDate()).slice(-2) + ' ' + ('0' + now.getHours()).slice(-2) + ':' + ('0' + now.getMinutes()).slice(-2) + ':' + ('0' + now.getSeconds()).slice(-2);
    //elements.push(timestamp);

    //console.log('STATUS', JSON.stringify(status, null, 4));    

    elements.push(localTimeString(status.time, 'S'));
    elements.push(resultLabel);
    elements.push(status.deviceId);
    elements.push(status.session);
    elements.push(localTimeString(status.start, 'S'));
    elements.push(localTimeString(status.stop, 'S'));
    elements.push(status.rate);
    elements.push(status.range);
    elements.push('\"' + status.metadata.replace(/\"/g, '""') + '\"');  // "_sc=####"

    // Additional
    const code = extractMetadata(status.metadata, "_sc");
    elements.push(status.gyro);
    elements.push('\"' + code + '\"');      // alphanumeric subject code

    // Append to the current day's log
    const reportLine = elements.join(',');
    const key = logPrefix + (new Date()).toISOString().slice(0, 10).replace(/[^0-9]/g, '');   // Today (UTC, numeric YYYYMMDD)

    console.log("LOG: " + reportLine);
    localStorage.setItem(key, (localStorage.getItem(key) || '') + reportLine + '\r\n');
}

const logFetch = () => {
    const keys = Object.keys(localStorage).filter(key => key.startsWith(logPrefix)).sort();
    const dayLogs = keys.map(key => localStorage.getItem(key));
    const fullLog = dayLogs.join('');
    return fullLog;
}

const logClear = () => {
    //localStorage.clear();
    const keys = Object.keys(localStorage).filter(key => key.startsWith(logPrefix));
    for (let key of keys) {
        localStorage.removeItem(key);
    }
}

const reconfigure = (clear, focus) => {
    document.querySelector('body').classList.remove('completed');
    disconnectClearCode = false;
    if (clear) {
        keyInput.setValue('');
        //document.querySelector('#code').value = '';
    }
    if (focus && typeof globalParams.focus !== 'undefined') {
        document.querySelector('#code').select();
        document.querySelector('#code').focus();
    }
    codeChanged(document.querySelector('#code').value);
}

const doCancelScan = async () => {
    try {
        console.log('BARCODE: Cancel: Awaiting...')
        await Barcode.cancel();
        // console.log('BARCODE: Cancel: ...awaited')
    } catch (e) {
        console.error('BARCODE: Error during cancellation: ' + e);
    }
}

const cancelScan = () => {
    // console.log('BARCODE: Cancel: Trigger')
    doCancelScan();
    // console.log('BARCODE: Cancel: End of trigger')
}

let isConfiguring = false;
const submit = async () => {
    //const code = document.querySelector(codeInput).value;
    if (isConfiguring) {
        setResult('(device busy)', true);
        return;
    }
    try {
        document.querySelector('body').classList.add('configuring');
        isConfiguring = true;

        // Cancel any scan in progress
        cancelScan();

        document.querySelector('#configure').setAttribute('disabled', 'true');
        document.querySelector('#start-scan').setAttribute('disabled', 'true');
        document.querySelector('#stop-scan').setAttribute('disabled', 'true');

        setResult('Configuring...', false);
        const config = configFromForm();
        console.log(JSON.stringify(config, null, 4));
        try {
            const status = await currentDevice.configure(config);
            console.log('CONFIG-STATUS: ' + JSON.stringify(status));

            let deviceType = '???';
            if (currentDevice.status && currentDevice.status.id && currentDevice.status.id.deviceType) {
                deviceType = currentDevice.status.id.deviceType;
            } else if (currentDevice.deviceType) {
                deviceType = currentDevice.deviceType;
            }

            const mismatches = configMismatches(config, status);
            if (mismatches.length == 0) {
                setResult('ℹ️ Configured', false);
                document.querySelector('body').classList.add('completed');

                logRecord(deviceType + '-CONFIG-OK', status);
                
                // Removing after a successful configure will clear the code
                disconnectClearCode = true;
            } else {
                setResult('ℹ️ Configured but mismatched: ' + JSON.stringify(mismatches), true);
                logRecord(deviceType + '-CONFIG-FAILURE', config);
            }

        } catch (e) {
            let deviceType = '???';
            if (currentDevice.status && currentDevice.status.id && currentDevice.status.id.deviceType) {
                deviceType = currentDevice.status.id.deviceType;
            } else if (currentDevice.deviceType) {
                deviceType = currentDevice.deviceType;
            }
            
            console.log('CONFIG-ERROR: ' + JSON.stringify(e));
            logRecord(deviceType + '-CONFIG-ERROR', config);
            setResult(e, true);
        }
    } catch (e) {
        console.log('CONFIGURATION: ' + e);
        setResult(e, true);
    } finally {
        document.querySelector('body').classList.remove('configuring');
        isConfiguring = false;
        
        document.querySelector('#configure').removeAttribute('disabled');
        document.querySelector('#start-scan').removeAttribute('disabled');
        document.querySelector('#stop-scan').removeAttribute('disabled');
    }
};

let diagnosticLabel = null;
let diagnosticTimestamp = new Date();
function diagnosticResults(diagnostic, label = null) {
    diagnosticLabel = label;
    diagnosticTimestamp = new Date();
    document.querySelector('.diagnostic-fieldset legend').innerText = 'Diagnostic Report' + (diagnosticLabel ? ': ' + diagnosticLabel : '');
    const diagnosticText = diagnostic ? JSON.stringify(diagnostic, null, 4) : '';
    console.dir(diagnostic);
    const diagnosticElement = document.querySelector('#diagnostic-text');
    diagnosticElement.value = diagnosticText;
    diagnosticElement.focus();
    diagnosticElement.select();
    diagnosticElement.scrollTo(0, 0);
    document.querySelector('body').classList.add('diagnostics-open');
    updateDiagnostics();
}

function diagnosticClear() {
    diagnosticResults(null, null);
    document.querySelector('#diagnostic-file').value = '';
    if (typeof globalParams.diagnostics == 'undefined') {
        document.querySelector('body').classList.remove('diagnostics-open');
    }
}

function refresh() {
    reconfigure(true, true);
    location.reload();
}

function runFileDiagnostic(inputFilename, fileData) {
    console.log('FILE-DIAGNOSTICS: (' + fileData.byteLength + ' bytes) -- ' + inputFilename);
    const diagnostic = {};
    diagnostic.version = version;
    diagnostic.errors = [];
    diagnostic.time = new Date();
    diagnostic.file = {
        filename: inputFilename,
        length: fileData.byteLength,
        source: 'file',
    };
    
    // First sector (header)
    if (fileData.byteLength >= 1 * 512) {
        try {
            diagnostic.header = parseHeader(new DataView(fileData.buffer, 0 * 512, 512));
        } catch (e) {
            console.dir(e);
            diagnostic.errors.push('Could not parse header: ' + JSON.stringify(e));
        }
    }

    // Seconds sector (reserved header)

    // Third sector (first data sector)
    if (fileData.byteLength >= 3 * 512) {
        try {
            diagnostic.first = parseData(new DataView(fileData.buffer, 2 * 512, 512));
        } catch (e) {
            console.dir(e);
            diagnostic.errors.push('Could not parse first data: ' + JSON.stringify(e));
        }
    }

    // Last sector (last data sector)
    if (fileData.byteLength >= 4 * 512) {
        try {
            diagnostic.last = parseData(new DataView(fileData.buffer, fileData.byteLength - 512, 512));
        } catch (e) {
            console.dir(e);
            diagnostic.errors.push('Could not parse last data: ' + JSON.stringify(e));
        }
    }

    diagnosticResults(diagnostic, inputFilename);
}

window.addEventListener('DOMContentLoaded', async (event) => {
    domLoaded = true;

    version = document.querySelector('#version').textContent.split(/[ ]/)[0].trim();
    document.querySelector('.version').textContent = version;

    deviceManager = new DeviceManager(allowUsb, allowSerial);
    keyInput = new KeyInput(codeInput);

    await updateStatus();
    keyInput.start(codeChanged, submit);

    for (let warning of deviceManager.warnings) {
        document.getElementById('warnings').appendChild(document.createTextNode('⚠️ ' + warning));
    }

    deviceManager.startup(deviceChanged);

    const reconfigureButton = document.querySelector('#reconfigure');
    if (reconfigureButton) {
        reconfigureButton.addEventListener('click', async () => {
            reconfigure(false, true);
        });
    }

    document.querySelector('#configure_new').addEventListener('click', async () => {
        reconfigure(true, true);
    });

    document.querySelector('#add_usb_device').addEventListener('click', async () => {
        try {
            await deviceManager.userAddUsbDevice();
        } catch (e) {
            setResult(e, true);
        }
    });

    document.querySelector('#add_serial_device').addEventListener('click', async () => {
        try {
            await deviceManager.userAddSerialDevice();
        } catch (e) {
            setResult(e, true);
        }
    });

    document.querySelector('#diagnostics-toggle').addEventListener('click', (e) => {
        e.preventDefault();
        if (document.querySelector('body').classList.contains('diagnostics-open')) {
            diagnosticClear();
        } else {
            diagnosticResults(null, null);
        }
    });
        
    document.querySelector('#diagnostic-run').addEventListener('click', async () => {
        try {
            document.querySelector('body').classList.add('running-diagnostic');
            updateDiagnostics();
            if (currentDevice) {
                let diagnostic = await currentDevice.runDiagnostic();
                const label = (diagnostic && diagnostic.id && diagnostic.id.deviceId) ? diagnostic.id.deviceId : 'unknown';
                diagnostic = { version, ...diagnostic };
                diagnosticResults(diagnostic, label);
            }
        } catch (e) {
            setResult(e, true);
        } finally {
            document.querySelector('body').classList.remove('running-diagnostic');
            updateDiagnostics();
        }
    });
    
    document.querySelector('#diagnostic-data-download').addEventListener('click', async () => {
        function duration(time) {
            if (!time) return '-';
            let result = '';
            if (time >= 60 * 60) { result = result + Math.floor(time / 60 / 60) + 'h'; time = time - Math.floor(time / 60 / 60) * 60 * 60; }
            if (time >= 60) { result = result + Math.floor(time / 60) + 'm'; time = time - Math.floor(time / 60) * 60; }
            result = result + Math.floor(time) + 's';
            return result;
        }
        
        const message = 'Experimental, slow, data download...';
        try {
            document.querySelector('body').classList.add('running-diagnostic');
            //diagnosticResults('', null);
            if (!currentDevice) throw new Error('No device');
            if (window.confirm('Run experimental (very slow) data download from device?')) {
                currentDevice.updateState(message + ' - starting...');
                await currentDevice.runDownload((progress) => {
                    console.log(JSON.stringify(progress));
                    currentDevice.updateState(message + ' - ' + (progress.proportion * 100).toFixed(3) + '%, after ' + duration(progress.elapsed) + ', remaining ' + duration(progress.estimatedRemaining) + '.');
                });
                currentDevice.updateState(message + ' - complete!');
            }
        } catch (e) {
            currentDevice.updateState(message + ' - error');
            setResult('Download error: ' + JSON.stringify(e), true);
        } finally {
            document.querySelector('body').classList.remove('running-diagnostic');
            updateDiagnostics();
        }        
    });

    document.querySelector('#diagnostic-reset').addEventListener('click', async () => {
        try {
            document.querySelector('body').classList.add('running-diagnostic');
            diagnosticResults('', null);
            if (currentDevice) {
                const wipeMessage = 'CAUTION: You want to DELETE ALL DATA from this device and RESET the device?';
                if (!window.confirm(wipeMessage)) {
                    throw 'Reset cancelled';
                }
                const idMessage = 'WIPE and RESET the device now?  (Enter ID from device case to reset the device ID, or leave blank to keep the current ID)';
                const idString = window.prompt(idMessage, '');
                if (idString === null) throw 'Reset cancelled';
                if (idString !== '') {
                    const id = parseInt(idString)
                    if (id != idString || id < 0 || id > 4294967295) {
                        throw 'Invalid ID: ' + idString;
                    }
                }
                await currentDevice.runReset(idString);
                diagnosticResults('Device reset' + (idString ? ': ' + idString : ''), null);
            }
        } catch (e) {
            setResult(e, true);
        } finally {
            document.querySelector('body').classList.remove('running-diagnostic');
            updateDiagnostics();
        }
    });

    document.querySelector('#diagnostic-copy').addEventListener('click', async () => {
        const diagnosticElement = document.querySelector('#diagnostic-text');
        if ('clipboard' in navigator) {
            navigator.clipboard.writeText(diagnosticElement.value)
        } else {
            diagnosticElement.focus();
            diagnosticElement.select();
            diagnosticElement.scrollTo(0, 0);
            document.execCommand('copy');
        }
    });

    document.querySelector('#diagnostic-download').addEventListener('click', async () => {
        const timestamp = diagnosticTimestamp.toISOString().replace(/[^0-9]/g, '').substring(0, 14);
        const filename = 'diagnostic_' + timestamp + (diagnosticLabel ? '_' + diagnosticLabel : '') + '.txt';
        const diagnosticData = document.querySelector('#diagnostic-text').value;
        download(filename, diagnosticData, 'text/plain');
    });


    function setFile(file) {
        const reader = new FileReader();
        reader.onload = async function(event) {
            const inputFilename = file.name;
            const inputContents = new Uint8Array(event.target.result);
            runFileDiagnostic(inputFilename, inputContents);
        };
        reader.readAsArrayBuffer(file);
    }

    function fileChange(event) {
        const fileList = event.target.files;
        const file = fileList[0];
        setFile(file);
    }

    document.querySelector('#diagnostic-file').addEventListener('change', fileChange);

    document.body.addEventListener('dragover', function(event) {
        if (!document.querySelector('body').classList.contains('diagnostics-open')) return;
        event.preventDefault();
    });

    document.body.addEventListener('drop', function(event) {
        if (!document.querySelector('body').classList.contains('diagnostics-open')) return;
        if (event.dataTransfer.files && event.dataTransfer.files.length > 0) {
            event.preventDefault();
            const file = event.dataTransfer.files[0];
            document.querySelector('#diagnostic-file').files = event.dataTransfer.files;
            setFile(file);
        }
    });

    for (let input of ['#delay']) {
        const elem = document.querySelector(input);
        elem.addEventListener('change', delayChanged);
        elem.addEventListener('input', delayChanged);
        //elem.addEventListener('propertychange', delayChanged);
    }

    for (let input of ['#start']) {
        const elem = document.querySelector(input);
        elem.addEventListener('change', startChanged);
        elem.addEventListener('input', startChanged);
        //elem.addEventListener('propertychange', startChanged);
    }

    for (let input of ['#duration']) {
        const elem = document.querySelector(input);
        elem.addEventListener('change', durationChanged);
        elem.addEventListener('input', durationChanged);
        //elem.addEventListener('propertychange', durationChanged);
    }

    for (let input of ['#stop']) {
        const elem = document.querySelector(input);
        elem.addEventListener('change', stopChanged);
        elem.addEventListener('input', stopChanged);
        //elem.addEventListener('propertychange', stopChanged);
    }

    for (let input of ['#session', '#rate', '#range', '#gyro', '#delay', '#start', '#duration', '#stop', '#metadata', '#minbattery']) {
        const elem = document.querySelector(input);
        elem.addEventListener('change', updateEnabled);
        elem.addEventListener('input', updateEnabled);
        elem.addEventListener('propertychange', updateEnabled);
    }

    clearConfig();

    if (!navigator.usb) {
        document.querySelector('#add_usb_device').setAttribute('disabled', 'true');
    }
    if (!navigator.serial) {
        document.querySelector('#add_serial_device').setAttribute('disabled', 'true');
    }

    document.querySelector('#reset').addEventListener('click', (e) => {
        refresh();
    });

    document.querySelector('#log-download').addEventListener('click', (e) => {
        e.preventDefault();
        try {
            const fullLog = logFetch();
            const filename = 'log_' + (new Date()).toISOString().replace(/[^0-9]/g, '') + '.csv';
            download(filename, fullLog, 'text/csv;charset=utf-8');    // 'text/plain;charset=utf-8', 'application/binary'
        } catch (e) {
            console.log(e);
        }
    });
    document.querySelector('#log-clear').addEventListener('click', (e) => {
        e.preventDefault();
        let destroy = false;
        if (true) {
            const response = prompt("DESTROY data by deleting and clearing all of the configuration logs?  Type DESTROY in capitals to confirm.");
            if (response != null) {
                if (response === 'DESTROY') destroy = true;
                else alert('Did not delete logs');
            }
        } else {
            destroy = confirm("DESTROY data by deleting and clearing all of the configuration logs?");
        }
        if (destroy) {
            try {
                logClear();
            } catch (e) {
                console.log(e);
            }
        }
    });

    document.querySelector('#start-scan').addEventListener('click', async () => {
        try {
            document.querySelector('body').classList.add('scanning');
            const scanResult = await Barcode.scan({
                readers: scanReaders,
            });
            if (scanResult != null) {
                console.log('SCAN: Result=' + scanResult);
                keyInput.setValue(scanResult);
            } else {
                console.log('SCAN: No result.');
            }
        } catch (e) {
            console.log('SCAN: Error=' + JSON.stringify(e));
            setResult(e, true);
        } finally {
            document.querySelector('body').classList.remove('scanning');
        }
    });

    document.querySelector('#stop-scan').addEventListener('click', cancelScan);

    // Call again now the DOM is loaded
    parametersChanged();

    const timed = () => {
        delayChanged();
        deviceManager.refreshDevices();
    };

    setInterval(timed, 5 * 1000);

});


